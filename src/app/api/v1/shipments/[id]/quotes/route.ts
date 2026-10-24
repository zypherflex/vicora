import { authed, body } from "@/server/http/api";
import { submitQuote } from "@/server/services/quotes";
import { submitQuoteSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => submitQuote(ctx, params.id, await body(req, submitQuoteSchema)));
