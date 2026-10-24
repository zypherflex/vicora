import { eq } from "drizzle-orm";
import { canTransition, SHIPMENT_STATUS_LABEL, type ShipmentStatus, type TransitionActor } from "@/lib/domain";
import type { Ctx } from "@/server/authz/context";
import { shipments, shipmentStatusHistory } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import { audit, recordEvent, type ShipmentAccess } from "./common";

export function actorFor(access: ShipmentAccess): TransitionActor[] {
  const out: TransitionActor[] = [];
  if (access.isCustomer) out.push("CUSTOMER");
  if (access.isProvider) out.push("PROVIDER");
  if (access.isExecutor) out.push("EXECUTOR");
  return out;
}

/**
 * The single path for changing a shipment's status. Validates the transition against the
 * status model and the caller's role on the shipment, and records who changed it and when.
 * Pass actor "SYSTEM" only from services performing a validated side effect (e.g. quote acceptance).
 */
export async function transitionShipment(
  ctx: Ctx,
  access: ShipmentAccess,
  to: ShipmentStatus,
  opts: { actor?: TransitionActor; reason?: string | null; customerTracking?: boolean } = {},
) {
  const from = access.shipment.status;
  if (from === to) return access.shipment;
  const actors: TransitionActor[] = opts.actor ? [opts.actor] : actorFor(access);
  if (!actors.some((a) => canTransition(from, to, a))) {
    throw new AppError("INVALID_TRANSITION", `Cannot move a shipment from ${SHIPMENT_STATUS_LABEL[from]} to ${SHIPMENT_STATUS_LABEL[to]}`, {
      from,
      to,
      actors,
    });
  }
  const [updated] = await ctx.db
    .update(shipments)
    .set({ status: to, updatedAt: new Date(), ...(to === "CANCELLED" ? { cancelledReason: opts.reason ?? null } : {}) })
    .where(eq(shipments.id, access.shipment.id))
    .returning();
  await ctx.db.insert(shipmentStatusHistory).values({
    shipmentId: access.shipment.id,
    fromStatus: from,
    toStatus: to,
    actorUserId: ctx.user.id,
    actorOrgId: ctx.org.id,
    reason: opts.reason ?? null,
  });
  await recordEvent(ctx, access.shipment.id, {
    type: "STATUS_CHANGED",
    title: `Status: ${SHIPMENT_STATUS_LABEL[to]}`,
    detail: { from, to, reason: opts.reason ?? null },
    customerTracking: opts.customerTracking ?? ["BOOKED", "DISPATCHED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(to),
  });
  await audit(ctx, "shipment.status_changed", "shipment", access.shipment.id, { before: { status: from }, after: { status: to } });
  access.shipment = updated;
  return updated;
}
