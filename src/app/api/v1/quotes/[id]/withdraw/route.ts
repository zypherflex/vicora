import { authed } from "@/server/http/api";
import { withdrawQuote } from "@/server/services/quotes";

export const POST = authed(({ ctx, params }) => withdrawQuote(ctx, params.id));
