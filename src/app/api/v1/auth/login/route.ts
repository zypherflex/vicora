import { NextResponse } from "next/server";
import { body, publicRoute, withSessionCookie } from "@/server/http/api";
import { rateLimit } from "@/server/http/rate-limit";
import { login } from "@/server/services/orgs";
import { loginSchema } from "@/server/validators";

export const POST = publicRoute(
  async ({ req, meta }) => {
    const input = await body(req, loginSchema);
    // Second limiter per account to slow credential stuffing across many IPs.
    await rateLimit(`login-account:${input.email}`, 10, 900);
    const r = await login(input.email, input.password, meta);
    return withSessionCookie(NextResponse.json({ userId: r.user.id }), r.session.token, r.session.expiresAt);
  },
  { rateLimit: { key: "login-ip", limit: 30, windowSeconds: 900 } },
);
