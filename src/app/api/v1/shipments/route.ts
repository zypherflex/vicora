import { authed, body, query } from "@/server/http/api";
import { createShipment, listShipments } from "@/server/services/shipments";
import { createShipmentSchema, shipmentListQuery } from "@/server/validators";

export const GET = authed(async ({ req, ctx }) => listShipments(ctx, query(req, shipmentListQuery)));
export const POST = authed(async ({ req, ctx }) => createShipment(ctx, await body(req, createShipmentSchema)));
