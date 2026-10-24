import { z } from "zod";
import { authed, body } from "@/server/http/api";
import { assignVehiclesToTrip } from "@/server/services/fleet";

export const POST = authed(async ({ req, ctx, params }) => assignVehiclesToTrip(ctx, params.id, (await body(req, z.object({ vehicleIds: z.array(z.string().uuid()).min(1).max(12) }))).vehicleIds));
