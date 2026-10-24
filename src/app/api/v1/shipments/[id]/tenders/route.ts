import { authed, body } from "@/server/http/api";
import { createTender } from "@/server/services/operations";
import { tenderSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => createTender(ctx, params.id, await body(req, tenderSchema)));
