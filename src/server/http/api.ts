import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, resolveSession, type AuthState } from "@/server/auth/session";
import { runAs, type Ctx } from "@/server/authz/context";
import { env } from "@/server/env";
import { AppError } from "./errors";
import { log } from "./logger";
import { rateLimit } from "./rate-limit";

export interface RequestMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export function clientIp(h: Headers): string | undefined {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
}

export function errorBody(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details, requestId } } };
  }
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "The request did not pass validation",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          requestId,
        },
      },
    };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "An unexpected error occurred", requestId } } };
}

/** Reject cross-site state-changing requests that carry the session cookie. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // Non-browser clients (tests, CLI). Cookie is SameSite=Lax as a second line.
  const allowed = new Set([new URL(env().APP_URL).host, req.headers.get("host")]);
  if (!allowed.has(new URL(origin).host)) throw new AppError("FORBIDDEN", "Cross-origin request rejected");
}

type Handler<T> = (args: { req: NextRequest; ctx: Ctx; params: Record<string, string>; meta: RequestMeta; auth: AuthState }) => Promise<T>;
type PublicHandler<T> = (args: { req: NextRequest; params: Record<string, string>; meta: RequestMeta }) => Promise<T>;

interface Options {
  rateLimit?: { key: string; limit: number; windowSeconds: number };
  /** Respond with a raw Response instead of JSON. */
  raw?: boolean;
}

async function finish(result: unknown, meta: RequestMeta, started: number, req: NextRequest, status = 200) {
  const res = result instanceof Response ? result : NextResponse.json(result ?? { ok: true }, { status });
  res.headers.set("x-request-id", meta.requestId);
  log.info("request", { requestId: meta.requestId, method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - started });
  return res;
}

function fail(err: unknown, meta: RequestMeta, started: number, req: NextRequest) {
  const { status, body } = errorBody(err, meta.requestId);
  if (status >= 500) log.error("request_failed", { requestId: meta.requestId, path: req.nextUrl.pathname, err: String((err as Error)?.stack ?? err) });
  else log.warn("request_rejected", { requestId: meta.requestId, path: req.nextUrl.pathname, status, code: body.error.code });
  const res = NextResponse.json(body, { status });
  res.headers.set("x-request-id", meta.requestId);
  if (status === 429 && err instanceof AppError) res.headers.set("retry-after", String((err.details as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60));
  return res;
}

function metaFor(req: NextRequest): RequestMeta {
  const incoming = req.headers.get("x-request-id");
  return {
    requestId: incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID(),
    ip: clientIp(req.headers),
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}

type RouteCtx = { params: Promise<Record<string, string>> };

/** Authenticated, RLS-scoped API route. */
export function authed<T>(handler: Handler<T>, opts: Options = {}) {
  return async (req: NextRequest, route: RouteCtx) => {
    const started = Date.now();
    const meta = metaFor(req);
    try {
      assertSameOrigin(req);
      const auth = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value ?? bearer(req));
      if (!auth) throw new AppError("UNAUTHENTICATED", "Sign in required");
      if (opts.rateLimit) await rateLimit(`${opts.rateLimit.key}:${auth.user.id}`, opts.rateLimit.limit, opts.rateLimit.windowSeconds);
      const params = (await route?.params) ?? {};
      const out = await runAs(auth, meta, (ctx) => handler({ req, ctx, params, meta, auth }));
      return finish(out, meta, started, req, req.method === "POST" ? 201 : 200);
    } catch (err) {
      return fail(err, meta, started, req);
    }
  };
}

/** Authenticated route that does not open a tenant transaction (session management, org switching). */
export function sessionOnly<T>(handler: (args: { req: NextRequest; auth: AuthState; meta: RequestMeta; params: Record<string, string> }) => Promise<T>) {
  return async (req: NextRequest, route: RouteCtx) => {
    const started = Date.now();
    const meta = metaFor(req);
    try {
      assertSameOrigin(req);
      const auth = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value ?? bearer(req));
      if (!auth) throw new AppError("UNAUTHENTICATED", "Sign in required");
      const params = (await route?.params) ?? {};
      return finish(await handler({ req, auth, meta, params }), meta, started, req);
    } catch (err) {
      return fail(err, meta, started, req);
    }
  };
}

export function publicRoute<T>(handler: PublicHandler<T>, opts: Options = {}) {
  return async (req: NextRequest, route: RouteCtx) => {
    const started = Date.now();
    const meta = metaFor(req);
    try {
      if (opts.rateLimit) await rateLimit(`${opts.rateLimit.key}:${meta.ip ?? "unknown"}`, opts.rateLimit.limit, opts.rateLimit.windowSeconds);
      const params = (await route?.params) ?? {};
      return finish(await handler({ req, params, meta }), meta, started, req);
    } catch (err) {
      return fail(err, meta, started, req);
    }
  };
}

function bearer(req: NextRequest): string | undefined {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export async function body<S extends ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON");
  }
  return schema.parse(json);
}

export function query<S extends ZodType>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

/* ---------------------------------------------------------------- Server components */

export async function currentAuth(): Promise<AuthState | null> {
  const c = await cookies();
  return resolveSession(c.get(SESSION_COOKIE)?.value);
}

export async function pageMeta(): Promise<RequestMeta> {
  const h = await headers();
  return { requestId: h.get("x-request-id") ?? randomUUID(), ip: clientIp(h) };
}

export function withSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production" || env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
