import { authed } from "@/server/http/api";
import { completeShipment } from "@/server/services/finance";

export const POST = authed(({ ctx, params }) => completeShipment(ctx, params.id));
