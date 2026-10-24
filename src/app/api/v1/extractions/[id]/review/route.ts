import { authed, body } from "@/server/http/api";
import { reviewExtraction } from "@/server/services/customs";
import { extractionReviewSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => reviewExtraction(ctx, params.id, await body(req, extractionReviewSchema)));
