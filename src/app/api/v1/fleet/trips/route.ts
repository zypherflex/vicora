import { authed, body } from "@/server/http/api";
import { createTrip } from "@/server/services/fleet";
import { tripSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx }) => createTrip(ctx, await body(req, tripSchema)));
