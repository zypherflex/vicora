import { authed, body } from "@/server/http/api";
import { setCustomsStatus } from "@/server/services/customs";
import { customsStatusSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => setCustomsStatus(ctx, params.id, await body(req, customsStatusSchema)));
