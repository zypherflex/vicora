import { authed, body } from "@/server/http/api";
import { dispatchLeg } from "@/server/services/operations";
import { dispatchSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => dispatchLeg(ctx, params.id, await body(req, dispatchSchema)));
