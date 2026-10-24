import { authed } from "@/server/http/api";
import { listFleet } from "@/server/services/fleet";

export const GET = authed(({ ctx }) => listFleet(ctx));
