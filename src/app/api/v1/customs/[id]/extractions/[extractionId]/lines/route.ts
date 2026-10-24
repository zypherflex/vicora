import { authed, body } from "@/server/http/api";
import { createLinesFromExtraction } from "@/server/services/brokerage";
import { linesFromExtractionSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => createLinesFromExtraction(ctx, params.id, params.extractionId, (await body(req, linesFromExtractionSchema)).indexes));
