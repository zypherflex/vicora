import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSession, resolveSession } from "@/server/auth/session";
import { body, publicRoute, withSessionCookie } from "@/server/http/api";
import { notFound } from "@/server/http/errors";
import { acceptInvitation, lookupInvitation } from "@/server/services/orgs";
import { acceptInviteSchema } from "@/server/validators";

export const GET = publicRoute(
  async ({ params }) => {
    const inv = await lookupInvitation(params.token);
    if (!inv) throw notFound("Invitation");
    return { email: inv.email, orgName: inv.orgName, orgType: inv.orgType, roles: inv.roles, hasAccount: inv.hasAccount, expiresAt: inv.expiresAt };
  },
  { rateLimit: { key: "invite-lookup", limit: 60, windowSeconds: 900 } },
);

export const POST = publicRoute(
  async ({ req, params, meta }) => {
    const input = await body(req, acceptInviteSchema.omit({ token: true }));
    const auth = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
    const r = await acceptInvitation({ ...input, token: params.token }, auth?.user.id ?? null, meta);
    const s = await createSession(r.userId, r.orgId, meta);
    return withSessionCookie(NextResponse.json({ orgId: r.orgId }, { status: 201 }), s.token, s.expiresAt);
  },
  { rateLimit: { key: "invite-accept", limit: 20, windowSeconds: 900 } },
);
