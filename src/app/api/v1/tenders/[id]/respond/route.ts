import { authed, body } from "@/server/http/api";
import { respondToTender } from "@/server/services/operations";
import { tenderResponseSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => {
  const { accept, notes } = await body(req, tenderResponseSchema);
  return respondToTender(ctx, params.id, accept, notes);
});
