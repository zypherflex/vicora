import { authed, body } from "@/server/http/api";
import { addEquipment } from "@/server/services/fleet";
import { equipmentSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx }) => addEquipment(ctx, await body(req, equipmentSchema)));
