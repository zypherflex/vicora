import { authed } from "@/server/http/api";
import { runPreflightReview } from "@/server/services/brokerage";

export const POST = authed(({ ctx, params }) => runPreflightReview(ctx, params.id));
