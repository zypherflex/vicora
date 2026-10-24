import { authed, body } from "@/server/http/api";
import { runCopilot } from "@/server/services/copilot";
import { copilotSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => {
  const b = await body(req, copilotSchema);
  return runCopilot(ctx, params.id, b.task, b.audience);
}, { rateLimit: { key: "copilot", limit: 60, windowSeconds: 3600 } });
