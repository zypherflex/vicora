import { authed, body } from "@/server/http/api";
import { requestDocument } from "@/server/services/documents";
import { documentRequirementSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => requestDocument(ctx, params.id, await body(req, documentRequirementSchema)));
