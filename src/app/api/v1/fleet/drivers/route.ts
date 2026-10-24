import { authed, body } from "@/server/http/api";
import { addDriver } from "@/server/services/fleet";
import { driverSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx }) => addDriver(ctx, await body(req, driverSchema)));
