import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { submitFiling } from "@/server/services/customs";

export const POST = authed(async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ adapter: z.string().max(40), confirm: z.boolean() }));
  return submitFiling(ctx, params.id, b.adapter, b.confirm);
});
