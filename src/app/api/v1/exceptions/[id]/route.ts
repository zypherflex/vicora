import { authed, body } from "@/server/http/api";
import { updateException } from "@/server/services/operations";
import { resolveExceptionSchema } from "@/server/validators";

export const PATCH = authed(async ({ req, ctx, params }) => updateException(ctx, params.id, await body(req, resolveExceptionSchema)));
