import "server-only";
import { notFound, redirect } from "next/navigation";
import type { AuthState } from "@/server/auth/session";
import { runAs, type Ctx } from "@/server/authz/context";
import { currentAuth, pageMeta } from "@/server/http/api";
import { AppError } from "@/server/http/errors";
import type { Permission } from "@/lib/permissions";

/** Resolve the session for a server component, redirecting to sign-in when absent. */
export async function requireAuth(): Promise<AuthState> {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  return auth;
}

/**
 * Run a server-component data load inside the same RLS-scoped transaction the API uses.
 * Not-found and forbidden errors render the 404 page so pages never leak existence.
 */
export async function load<T>(fn: (ctx: Ctx) => Promise<T>, opts: { need?: Permission } = {}): Promise<T> {
  const auth = await requireAuth();
  if (!auth.active) redirect("/login?reason=no-org");
  if (opts.need && !auth.active.permissions.has(opts.need)) notFound();
  try {
    return await runAs(auth, await pageMeta(), fn);
  } catch (err) {
    if (err instanceof AppError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
}

/** Serializable view of the session for client components. */
export function viewer(auth: AuthState) {
  const m = auth.active!;
  return {
    userId: auth.user.id,
    name: auth.user.name,
    email: auth.user.email,
    isPlatformAdmin: auth.user.isPlatformAdmin,
    org: { id: m.orgId, name: m.orgName, type: m.orgType, isDemo: m.orgIsDemo, timezone: m.orgTimezone, currency: m.orgCurrency },
    roles: m.roles,
    perms: [...m.permissions] as Permission[],
    memberships: auth.memberships.map((x) => ({ orgId: x.orgId, orgName: x.orgName, orgType: x.orgType, isDemo: x.orgIsDemo })),
  };
}
export type Viewer = ReturnType<typeof viewer>;
