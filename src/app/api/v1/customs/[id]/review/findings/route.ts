import { authed, body } from "@/server/http/api";
import { resolveFinding } from "@/server/services/brokerage";
import { resolveFindingSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => resolveFinding(ctx, params.id, await body(req, resolveFindingSchema)));
