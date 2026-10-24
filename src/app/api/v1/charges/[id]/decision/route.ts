import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { decideCharge } from "@/server/services/finance";

export const POST = authed(async ({ req, ctx, params }) => decideCharge(ctx, params.id, (await body(req, z.object({ approve: z.boolean() }))).approve));
