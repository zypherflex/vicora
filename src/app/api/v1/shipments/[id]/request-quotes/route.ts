import { authed } from "@/server/http/api";
import { requestQuotes } from "@/server/services/shipments";

export const POST = authed(({ ctx, params }) => requestQuotes(ctx, params.id));
