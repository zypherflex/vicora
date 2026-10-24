import { authed, body } from "@/server/http/api";
import { createClassification } from "@/server/services/brokerage";
import { classificationSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx }) => createClassification(ctx, await body(req, classificationSchema)));
