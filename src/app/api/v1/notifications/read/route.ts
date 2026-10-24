import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { markNotificationsRead } from "@/server/services/comms";

export const POST = authed(async ({ req, ctx }) => {
  const b = await body(req, z.object({ ids: z.union([z.literal("all"), z.array(z.string().uuid()).max(200)]) }));
  return markNotificationsRead(ctx, b.ids);
});
