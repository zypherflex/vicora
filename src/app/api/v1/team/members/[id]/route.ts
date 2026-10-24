import { authed, body } from "@/server/http/api";
import { updateMember } from "@/server/services/orgs";
import { updateMemberSchema } from "@/server/validators";

export const PATCH = authed(async ({ req, ctx, params }) => updateMember(ctx, params.id, await body(req, updateMemberSchema)));
