import { authed } from "@/server/http/api";
import { requestExtraction } from "@/server/services/customs";

export const POST = authed(({ ctx, params }) => requestExtraction(ctx, params.id), { rateLimit: { key: "extract", limit: 60, windowSeconds: 3600 } });
