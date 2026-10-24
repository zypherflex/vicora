import { NextResponse } from "next/server";
import { body, publicRoute, withSessionCookie } from "@/server/http/api";
import { registerOrganization } from "@/server/services/orgs";
import { registerSchema } from "@/server/validators";

export const POST = publicRoute(
  async ({ req, meta }) => {
    const input = await body(req, registerSchema);
    const r = await registerOrganization(input, meta);
    return withSessionCookie(NextResponse.json({ userId: r.user.id, orgId: r.org.id }, { status: 201 }), r.session.token, r.session.expiresAt);
  },
  { rateLimit: { key: "register", limit: 10, windowSeconds: 3600 } },
);
