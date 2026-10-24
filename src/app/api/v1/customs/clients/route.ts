import { authed, body } from "@/server/http/api";
import { createClient, listClients } from "@/server/services/brokerage";
import { customsClientSchema } from "@/server/validators";

export const GET = authed(({ ctx }) => listClients(ctx));
export const POST = authed(async ({ req, ctx }) => createClient(ctx, await body(req, customsClientSchema)));
