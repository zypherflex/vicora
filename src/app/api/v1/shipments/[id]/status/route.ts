import { authed, body } from "@/server/http/api";
import { changeStatus } from "@/server/services/shipments";
import { transitionSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => {
  const { to, reason } = await body(req, transitionSchema);
  const s = await changeStatus(ctx, params.id, to, reason);
  return { status: s.status };
});
