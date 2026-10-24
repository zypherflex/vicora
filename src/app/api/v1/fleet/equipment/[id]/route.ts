import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { setEquipmentStatus } from "@/server/services/fleet";

export const PATCH = authed(async ({ req, ctx, params }) => setEquipmentStatus(ctx, params.id, (await body(req, z.object({ status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE"]) }))).status));
