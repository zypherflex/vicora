import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { reviewDocument } from "@/server/services/documents";

export const POST = authed(async ({ req, ctx, params }) => {
  const { status } = await body(req, z.object({ status: z.enum(["APPROVED", "REJECTED"]) }));
  return reviewDocument(ctx, params.id, status);
});
