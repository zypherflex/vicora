import { authed, body } from "@/server/http/api";
import { getClient, updateClient } from "@/server/services/brokerage";
import { customsClientSchema } from "@/server/validators";

export const GET = authed(({ ctx, params }) => getClient(ctx, params.clientId));
export const PATCH = authed(async ({ req, ctx, params }) => updateClient(ctx, params.clientId, await body(req, customsClientSchema.partial())));
