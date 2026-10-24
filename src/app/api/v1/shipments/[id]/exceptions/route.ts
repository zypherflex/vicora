import { authed, body } from "@/server/http/api";
import { openException } from "@/server/services/operations";
import { exceptionSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => openException(ctx, params.id, await body(req, exceptionSchema)));
