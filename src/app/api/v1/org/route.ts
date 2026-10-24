import { authed, body } from "@/server/http/api";
import { getOrgProfile, updateOrgSettings } from "@/server/services/orgs";
import { orgSettingsSchema } from "@/server/validators";

export const GET = authed(({ ctx }) => getOrgProfile(ctx));
export const PATCH = authed(async ({ req, ctx }) => updateOrgSettings(ctx, await body(req, orgSettingsSchema)));
