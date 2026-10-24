import { authed } from "@/server/http/api";
import { acceptQuote } from "@/server/services/quotes";

export const POST = authed(({ ctx, params }) => acceptQuote(ctx, params.id));
