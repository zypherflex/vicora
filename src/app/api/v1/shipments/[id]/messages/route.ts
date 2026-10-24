import { authed, body } from "@/server/http/api";
import { postMessage } from "@/server/services/comms";
import { messageSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => postMessage(ctx, params.id, await body(req, messageSchema)), { rateLimit: { key: "message", limit: 300, windowSeconds: 3600 } });
