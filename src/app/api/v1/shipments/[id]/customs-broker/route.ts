import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { appointCustomsBroker } from "@/server/services/customs";

export const POST = authed(async ({ req, ctx, params }) => appointCustomsBroker(ctx, params.id, (await body(req, z.object({ brokerOrgId: z.string().uuid() }))).brokerOrgId));
