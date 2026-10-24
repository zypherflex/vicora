import { authed, body } from "@/server/http/api";
import { decideClassification } from "@/server/services/brokerage";
import { classificationDecisionSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => decideClassification(ctx, params.itemId, (await body(req, classificationDecisionSchema)).decision));
