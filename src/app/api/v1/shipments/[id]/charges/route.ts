import { authed, body } from "@/server/http/api";
import { addCharge } from "@/server/services/finance";
import { chargeSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => addCharge(ctx, params.id, await body(req, chargeSchema)));
