import { authed, body } from "@/server/http/api";
import { applyClassification } from "@/server/services/brokerage";
import { applyClassificationSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => applyClassification(ctx, params.id, params.lineId, (await body(req, applyClassificationSchema)).classificationItemId));
