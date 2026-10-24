import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { recordPayablePaid } from "@/server/services/finance";

export const POST = authed(async ({ req, ctx, params }) => recordPayablePaid(ctx, params.id, (await body(req, z.object({ reference: z.string().trim().min(3).max(80) }))).reference));
