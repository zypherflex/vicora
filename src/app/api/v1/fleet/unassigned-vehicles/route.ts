import { authed } from "@/server/http/api";
import { unassignedVehicles } from "@/server/services/fleet";

export const GET = authed(({ ctx }) => unassignedVehicles(ctx));
