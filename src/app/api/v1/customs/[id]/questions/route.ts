import { authed, body } from "@/server/http/api";
import { askFile, listQuestions } from "@/server/services/brokerage";
import { askFileSchema } from "@/server/validators";

export const GET = authed(({ ctx, params }) => listQuestions(ctx, params.id));
export const POST = authed(async ({ req, ctx, params }) => askFile(ctx, params.id, (await body(req, askFileSchema)).question));
