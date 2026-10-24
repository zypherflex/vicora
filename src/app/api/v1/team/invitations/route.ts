import { authed, body } from "@/server/http/api";
import { inviteMember } from "@/server/services/orgs";
import { inviteSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx }) => inviteMember(ctx, await body(req, inviteSchema)), { rateLimit: { key: "invite", limit: 50, windowSeconds: 3600 } });
