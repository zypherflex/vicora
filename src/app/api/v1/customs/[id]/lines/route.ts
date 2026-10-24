import { authed, body } from "@/server/http/api";
import { upsertCustomsLine } from "@/server/services/customs";
import { customsLineSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => upsertCustomsLine(ctx, params.id, await body(req, customsLineSchema)));
