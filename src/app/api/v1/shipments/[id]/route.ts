import { authed } from "@/server/http/api";
import { getShipmentTwin } from "@/server/services/shipments";

export const GET = authed(({ ctx, params }) => getShipmentTwin(ctx, params.id));
