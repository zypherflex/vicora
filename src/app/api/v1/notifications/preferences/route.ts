import { authed, body } from "@/server/http/api";
import { getPreferences, savePreferences } from "@/server/services/comms";
import { notificationPrefSchema } from "@/server/validators";

export const GET = authed(({ ctx }) => getPreferences(ctx));
export const PUT = authed(async ({ req, ctx }) => savePreferences(ctx, await body(req, notificationPrefSchema)));
