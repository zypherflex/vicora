import { authed } from "@/server/http/api";
import { driverTrips } from "@/server/services/fleet";

export const GET = authed(({ ctx }) => driverTrips(ctx));
