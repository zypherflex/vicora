import { authed, body } from "@/server/http/api";
import { reportLocation } from "@/server/services/operations";
import { locationSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => reportLocation(ctx, params.id, await body(req, locationSchema)), { rateLimit: { key: "location", limit: 240, windowSeconds: 3600 } });
