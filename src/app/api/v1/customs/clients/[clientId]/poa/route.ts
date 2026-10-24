import { authed, body } from "@/server/http/api";
import { setPowerOfAttorney } from "@/server/services/brokerage";
import { poaSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => setPowerOfAttorney(ctx, params.clientId, await body(req, poaSchema)));
