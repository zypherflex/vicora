import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { LEG_STATUS_LABEL, LEG_TRANSITIONS, type LegStatus, type ShipmentStatus } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { haversineMiles } from "@/server/adapters/geocode";
import { can, requirePerm, type Ctx } from "@/server/authz/context";
import {
  charges,
  documents,
  drivers,
  equipment,
  locationPings,
  organizations,
  payables,
  shipmentExceptions,
  shipmentLegs,
  shipmentParties,
  shipmentStops,
  tenders,
  vehicles,
} from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type {
  dispatchSchema,
  exceptionSchema,
  legMilestoneSchema,
  locationSchema,
  resolveExceptionSchema,
  tenderSchema,
} from "@/server/validators";
import { audit, enqueue, loadShipmentAccess, recordEvent, requireParty, type ShipmentAccess } from "./common";
import { transitionShipment } from "./status";

const FORWARD: ShipmentStatus[] = ["BOOKED", "ASSIGNED", "DISPATCHED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];

/** Derive the shipment status implied by its legs and advance it (forward only), recording each step. */
export async function syncShipmentStatus(ctx: Ctx, access: ShipmentAccess) {
  const legs = await ctx.db.select().from(shipmentLegs).where(eq(shipmentLegs.shipmentId, access.shipment.id)).orderBy(asc(shipmentLegs.seq));
  const live = legs.filter((l) => l.status !== "CANCELLED");
  if (!live.length) return;
  const first = live[0];
  let target: ShipmentStatus = "BOOKED";
  if (first.executorOrgId && ["ACCEPTED", "DISPATCHED", "AT_PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_DELIVERY", "DELIVERED"].includes(first.status)) target = "ASSIGNED";
  if (["DISPATCHED", "AT_PICKUP"].includes(first.status)) target = "DISPATCHED";
  if (["PICKED_UP"].includes(first.status)) target = "PICKED_UP";
  if (live.some((l) => ["IN_TRANSIT", "AT_DELIVERY"].includes(l.status)) || (first.status === "DELIVERED" && live.length > 1)) target = "IN_TRANSIT";
  if (live.every((l) => l.status === "DELIVERED")) target = "DELIVERED";

  const cur = FORWARD.indexOf(access.shipment.status);
  const tgt = FORWARD.indexOf(target);
  if (cur < 0 || tgt <= cur) return;
  for (let i = cur + 1; i <= tgt; i++) {
    const next = FORWARD[i];
    // PICKED_UP → DELIVERED is allowed directly; skip IN_TRANSIT when it would not add information.
    await transitionShipment(ctx, access, next, { actor: "SYSTEM", reason: "Updated from leg progress" });
  }
}

/* ---------------------------------------------------------------- Tendering (broker → carrier) */

export async function createTender(ctx: Ctx, shipmentId: string, input: z.infer<typeof tenderSchema>) {
  requirePerm(ctx, "tender.create");
  const access = await requireParty(ctx, shipmentId);
  if (!access.isProvider) throw new AppError("FORBIDDEN", "Only the booked provider can tender this shipment");
  const [leg] = await ctx.db.select().from(shipmentLegs).where(and(eq(shipmentLegs.id, input.legId), eq(shipmentLegs.shipmentId, shipmentId)));
  if (!leg) throw notFound("Leg");
  if (leg.managerOrgId !== ctx.org.id) throw new AppError("FORBIDDEN", "You do not manage this leg");
  if (leg.status !== "PLANNED") throw conflict(`Leg is ${LEG_STATUS_LABEL[leg.status].toLowerCase()}; only planned legs can be tendered`);
  if (input.currency !== leg.currency) throw new AppError("VALIDATION_FAILED", `Tender currency must be ${leg.currency}`);
  const [carrier] = await ctx.db.select().from(organizations).where(eq(organizations.id, input.carrierOrgId));
  if (!carrier || !["CARRIER", "AUTO_TRANSPORT"].includes(carrier.type) || carrier.status !== "ACTIVE")
    throw new AppError("VALIDATION_FAILED", "Choose an active carrier or auto transport company");

  const [tender] = await ctx.db
    .insert(tenders)
    .values({
      shipmentId,
      legId: leg.id,
      fromOrgId: ctx.org.id,
      toOrgId: carrier.id,
      rateMinor: input.rateMinor,
      currency: input.currency,
      notes: input.notes,
      expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000),
      createdBy: ctx.user.id,
    })
    .returning();
  await ctx.db.update(shipmentLegs).set({ status: "TENDERED" }).where(eq(shipmentLegs.id, leg.id));
  await recordEvent(ctx, shipmentId, {
    type: "TENDER_OFFERED",
    title: `Leg ${leg.seq + 1} tendered to ${carrier.name}`,
    legId: leg.id,
    internal: true,
    detail: { tenderId: tender.id, rateMinor: input.rateMinor, currency: input.currency },
  });
  await enqueue(ctx.db, "notify.org", {
    orgId: carrier.id,
    type: "TENDER_OFFERED",
    title: `Load tender from ${ctx.org.name}`,
    body: `${access.shipment.reference}: ${formatMoney(input.rateMinor, input.currency)}. Respond before it expires.`,
    link: `/tenders`,
    shipmentId,
  });
  await audit(ctx, "tender.created", "tender", tender.id, { after: { legId: leg.id, carrierOrgId: carrier.id, rateMinor: input.rateMinor } });
  return tender;
}

export async function listTenders(ctx: Ctx) {
  requirePerm(ctx, "shipment.read");
  const rows = await ctx.db.select().from(tenders).orderBy(desc(tenders.createdAt)).limit(100);
  const legIds = rows.map((t) => t.legId);
  const legs = legIds.length ? await ctx.db.select().from(shipmentLegs).where(inArray(shipmentLegs.id, legIds)) : [];
  const stopIds = legs.flatMap((l) => [l.fromStopId, l.toStopId]).filter(Boolean) as string[];
  const stops = stopIds.length ? await ctx.db.select().from(shipmentStops).where(inArray(shipmentStops.id, stopIds)) : [];
  const orgIds = [...new Set(rows.flatMap((t) => [t.fromOrgId, t.toOrgId]))];
  const orgs = orgIds.length ? await ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)) : [];
  return rows.map((t) => {
    const leg = legs.find((l) => l.id === t.legId);
    return {
      ...t,
      leg,
      from: stops.find((s) => s.id === leg?.fromStopId) ?? null,
      to: stops.find((s) => s.id === leg?.toStopId) ?? null,
      fromOrgName: orgs.find((o) => o.id === t.fromOrgId)?.name ?? "",
      toOrgName: orgs.find((o) => o.id === t.toOrgId)?.name ?? "",
      incoming: t.toOrgId === ctx.org.id,
    };
  });
}

export async function respondToTender(ctx: Ctx, tenderId: string, accept: boolean, notes: string | null) {
  requirePerm(ctx, "tender.respond");
  const [t] = await ctx.db.select().from(tenders).where(and(eq(tenders.id, tenderId), eq(tenders.toOrgId, ctx.org.id)));
  if (!t) throw notFound("Tender");
  await ctx.db.execute(sql`select id from tenders where id = ${t.id} for update`);
  if (t.status !== "OFFERED") throw conflict(`This tender is already ${t.status.toLowerCase()}`);
  if (t.expiresAt && t.expiresAt < new Date()) {
    await ctx.db.update(tenders).set({ status: "EXPIRED" }).where(eq(tenders.id, t.id));
    await ctx.db.update(shipmentLegs).set({ status: "PLANNED" }).where(eq(shipmentLegs.id, t.legId));
    throw conflict("This tender has expired");
  }
  const now = new Date();
  await ctx.db.update(tenders).set({ status: accept ? "ACCEPTED" : "DECLINED", respondedBy: ctx.user.id, respondedAt: now, notes: notes ?? t.notes }).where(eq(tenders.id, t.id));

  if (!accept) {
    await ctx.db.update(shipmentLegs).set({ status: "PLANNED" }).where(eq(shipmentLegs.id, t.legId));
    await enqueue(ctx.db, "notify.org", { orgId: t.fromOrgId, type: "TENDER_DECLINED", title: `${ctx.org.name} declined a tender`, body: notes ?? "", link: `/shipments/${t.shipmentId}`, shipmentId: t.shipmentId });
    await audit(ctx, "tender.declined", "tender", t.id);
    return { accepted: false };
  }

  await ctx.db.insert(shipmentParties).values({ shipmentId: t.shipmentId, orgId: ctx.org.id, role: "CARRIER" }).onConflictDoNothing();
  await ctx.db
    .update(shipmentLegs)
    .set({ executorOrgId: ctx.org.id, status: "ACCEPTED", carrierRateMinor: t.rateMinor, currency: t.currency })
    .where(eq(shipmentLegs.id, t.legId));
  await ctx.db.insert(charges).values({
    shipmentId: t.shipmentId,
    kind: "PAYABLE",
    billerOrgId: ctx.org.id,
    billToOrgId: t.fromOrgId,
    code: "LINEHAUL",
    description: "Contracted carrier rate (tender)",
    quantityMilli: 1000,
    unitAmountMinor: t.rateMinor,
    amountMinor: t.rateMinor,
    currency: t.currency,
    status: "CONFIRMED",
    source: "TENDER",
    sourceId: t.id,
    createdBy: ctx.user.id,
    confirmedBy: ctx.user.id,
    confirmedAt: now,
  });
  await ctx.db.insert(payables).values({
    payerOrgId: t.fromOrgId,
    payeeOrgId: ctx.org.id,
    shipmentId: t.shipmentId,
    legId: t.legId,
    tenderId: t.id,
    amountMinor: t.rateMinor,
    currency: t.currency,
    status: "PENDING_POD",
    isDemo: ctx.org.isDemo,
  });
  const access = await loadShipmentAccess(ctx, t.shipmentId);
  await recordEvent(ctx, t.shipmentId, { type: "TENDER_ACCEPTED", title: `Carrier assigned: ${ctx.org.name}`, legId: t.legId, customerTracking: false });
  await syncShipmentStatus(ctx, access);
  await audit(ctx, "tender.accepted", "tender", t.id, { after: { rateMinor: t.rateMinor } });
  return { accepted: true };
}

/* ---------------------------------------------------------------- Dispatch */

export async function dispatchLeg(ctx: Ctx, shipmentId: string, input: z.infer<typeof dispatchSchema>) {
  requirePerm(ctx, "dispatch.manage");
  const access = await requireParty(ctx, shipmentId);
  const [leg] = await ctx.db.select().from(shipmentLegs).where(and(eq(shipmentLegs.id, input.legId), eq(shipmentLegs.shipmentId, shipmentId)));
  if (!leg) throw notFound("Leg");
  if (leg.executorOrgId !== ctx.org.id) throw new AppError("FORBIDDEN", "Only the assigned carrier can dispatch this leg");
  if (!["ACCEPTED", "DISPATCHED"].includes(leg.status)) throw conflict(`Leg is ${LEG_STATUS_LABEL[leg.status].toLowerCase()} and cannot be dispatched`);
  const [driver] = await ctx.db.select().from(drivers).where(and(eq(drivers.id, input.driverId), eq(drivers.orgId, ctx.org.id)));
  const [unit] = await ctx.db.select().from(equipment).where(and(eq(equipment.id, input.equipmentId), eq(equipment.orgId, ctx.org.id)));
  if (!driver) throw notFound("Driver");
  if (!unit) throw notFound("Equipment");
  if (driver.status === "INACTIVE") throw conflict("This driver is inactive");
  if (unit.status === "MAINTENANCE") throw conflict("This unit is in maintenance");
  if (driver.licenseExpiresAt && driver.licenseExpiresAt < new Date()) throw conflict("The driver's license on file has expired");

  const warnings: string[] = [];
  if (access.shipment.equipmentType && unit.type !== access.shipment.equipmentType)
    warnings.push(`Requested equipment is ${access.shipment.equipmentType}; dispatched unit is ${unit.type}`);

  // Release previous assignment if re-dispatching.
  if (leg.driverId && leg.driverId !== driver.id) await ctx.db.update(drivers).set({ status: "AVAILABLE" }).where(eq(drivers.id, leg.driverId));
  if (leg.equipmentId && leg.equipmentId !== unit.id) await ctx.db.update(equipment).set({ status: "AVAILABLE" }).where(eq(equipment.id, leg.equipmentId));

  await ctx.db
    .update(shipmentLegs)
    .set({
      driverId: driver.id,
      equipmentId: unit.id,
      status: "DISPATCHED",
      plannedPickupAt: input.plannedPickupAt ?? leg.plannedPickupAt,
      plannedDeliveryAt: input.plannedDeliveryAt ?? leg.plannedDeliveryAt,
    })
    .where(eq(shipmentLegs.id, leg.id));
  await ctx.db.update(drivers).set({ status: "ON_TRIP" }).where(eq(drivers.id, driver.id));
  await ctx.db.update(equipment).set({ status: "IN_USE" }).where(eq(equipment.id, unit.id));
  if (access.shipment.serviceType === "AUTO_TRANSPORT")
    await ctx.db.update(vehicles).set({ status: "ASSIGNED" }).where(and(eq(vehicles.shipmentId, shipmentId), eq(vehicles.status, "PENDING")));

  await recordEvent(ctx, shipmentId, {
    type: "DISPATCHED",
    title: `Leg ${leg.seq + 1} dispatched: ${driver.name}, unit ${unit.unitNumber}`,
    legId: leg.id,
    detail: { driverId: driver.id, equipmentId: unit.id, warnings },
  });
  if (driver.userId) {
    await enqueue(ctx.db, "notify.user", {
      userId: driver.userId,
      orgId: ctx.org.id,
      type: "DISPATCHED",
      title: `New trip: ${access.shipment.reference}`,
      link: `/driver`,
      shipmentId,
    });
  }
  await syncShipmentStatus(ctx, access);
  await audit(ctx, "leg.dispatched", "leg", leg.id, { after: { driverId: driver.id, equipmentId: unit.id } });
  return { warnings };
}

/* ---------------------------------------------------------------- Milestones & location */

function isDriverOnly(ctx: Ctx) {
  return ctx.roles.length > 0 && ctx.roles.every((r) => r === "DRIVER");
}

async function assertCanOperateLeg(ctx: Ctx, leg: typeof shipmentLegs.$inferSelect) {
  const isExecutor = leg.executorOrgId === ctx.org.id;
  const isManager = leg.managerOrgId === ctx.org.id;
  if (!isExecutor && !isManager) throw new AppError("FORBIDDEN", "Your organization is not operating this leg");
  if (isDriverOnly(ctx)) {
    const [d] = leg.driverId ? await ctx.db.select().from(drivers).where(eq(drivers.id, leg.driverId)) : [];
    if (!d || d.userId !== ctx.user.id) throw new AppError("FORBIDDEN", "Drivers can only update trips assigned to them");
  }
}

export async function recordLegMilestone(ctx: Ctx, shipmentId: string, legId: string, input: z.infer<typeof legMilestoneSchema>) {
  requirePerm(ctx, "milestone.record");
  const access = await requireParty(ctx, shipmentId);
  const [leg] = await ctx.db.select().from(shipmentLegs).where(and(eq(shipmentLegs.id, legId), eq(shipmentLegs.shipmentId, shipmentId)));
  if (!leg) throw notFound("Leg");
  await assertCanOperateLeg(ctx, leg);
  const to = input.status as LegStatus;
  if (!LEG_TRANSITIONS[leg.status].includes(to))
    throw new AppError("INVALID_TRANSITION", `Cannot record "${LEG_STATUS_LABEL[to]}" while the leg is ${LEG_STATUS_LABEL[leg.status].toLowerCase()}`, { from: leg.status, to });

  const at = input.occurredAt ?? new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw new AppError("VALIDATION_FAILED", "Milestone time cannot be in the future");

  const [legs, stopsAll] = await Promise.all([
    ctx.db.select().from(shipmentLegs).where(eq(shipmentLegs.shipmentId, shipmentId)),
    ctx.db.select().from(shipmentStops).where(eq(shipmentStops.shipmentId, shipmentId)),
  ]);
  const isFinalLeg = Math.max(...legs.map((l) => l.seq)) === leg.seq;

  if (to === "DELIVERED") {
    // Proof of delivery is required: an uploaded POD document or a named signer.
    if (!input.podDocumentId && !input.podSignerName) throw new AppError("VALIDATION_FAILED", "Proof of delivery is required: upload a POD or capture the receiver's name");
    if (input.podDocumentId) {
      const [doc] = await ctx.db.select().from(documents).where(and(eq(documents.id, input.podDocumentId), eq(documents.shipmentId, shipmentId)));
      if (!doc) throw notFound("Proof-of-delivery document");
    }
  }

  const patch: Partial<typeof shipmentLegs.$inferInsert> = { status: to };
  if (to === "PICKED_UP") patch.actualPickupAt = at;
  if (to === "DELIVERED") patch.actualDeliveryAt = at;
  await ctx.db.update(shipmentLegs).set(patch).where(eq(shipmentLegs.id, leg.id));

  if (access.shipment.serviceType === "AUTO_TRANSPORT") {
    const vf = input.vehicleIds?.length ? and(eq(vehicles.shipmentId, shipmentId), inArray(vehicles.id, input.vehicleIds)) : eq(vehicles.shipmentId, shipmentId);
    if (to === "PICKED_UP") await ctx.db.update(vehicles).set({ status: "PICKED_UP", pickedUpAt: at }).where(and(vf, inArray(vehicles.status, ["PENDING", "ASSIGNED"])));
    if (to === "DELIVERED" && isFinalLeg) await ctx.db.update(vehicles).set({ status: "DELIVERED", deliveredAt: at }).where(and(vf, eq(vehicles.status, "PICKED_UP")));
  }

  if (input.lat != null && input.lng != null) {
    await ctx.db.insert(locationPings).values({
      shipmentId,
      legId: leg.id,
      lat: input.lat,
      lng: input.lng,
      source: input.locationSource === "LIVE_GPS" ? "LIVE_GPS" : "MANUAL",
      label: LEG_STATUS_LABEL[to],
      reportedBy: ctx.user.id,
      recordedAt: at,
    });
  }

  const stop = stopsAll.find((s) => s.id === (["AT_PICKUP", "PICKED_UP"].includes(to) ? leg.fromStopId : leg.toStopId));
  await recordEvent(ctx, shipmentId, {
    type: "MILESTONE",
    title: `${LEG_STATUS_LABEL[to]}${stop ? ` — ${stop.city}, ${stop.state}` : ""}`,
    legId: leg.id,
    occurredAt: at,
    customerTracking: ["PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(to),
    detail: { status: to, note: input.note ?? null, podSignerName: input.podSignerName ?? null, podDocumentId: input.podDocumentId ?? null },
  });

  if (to === "DELIVERED") {
    if (leg.driverId) await ctx.db.update(drivers).set({ status: "AVAILABLE" }).where(eq(drivers.id, leg.driverId));
    if (leg.equipmentId) await ctx.db.update(equipment).set({ status: "AVAILABLE" }).where(eq(equipment.id, leg.equipmentId));
  }
  await syncShipmentStatus(ctx, access);
  await audit(ctx, "leg.milestone", "leg", leg.id, { before: { status: leg.status }, after: { status: to } });
  return { status: to };
}

/** Rough ETA from the latest position: straight-line miles × 1.2 road factor at 50 mph. Labeled as an estimate. */
export function estimateEta(from: { lat: number; lng: number }, to: { lat: number; lng: number }, now = new Date()) {
  const miles = haversineMiles(from, to) * 1.2;
  return { miles: Math.round(miles), eta: new Date(now.getTime() + (miles / 50) * 3600_000) };
}

export async function reportLocation(ctx: Ctx, shipmentId: string, input: z.infer<typeof locationSchema>) {
  requirePerm(ctx, "location.report");
  await requireParty(ctx, shipmentId);
  const legs = await ctx.db.select().from(shipmentLegs).where(eq(shipmentLegs.shipmentId, shipmentId)).orderBy(asc(shipmentLegs.seq));
  const leg = input.legId ? legs.find((l) => l.id === input.legId) : legs.find((l) => l.executorOrgId === ctx.org.id && !["DELIVERED", "CANCELLED"].includes(l.status));
  if (!leg) throw notFound("Active leg");
  await assertCanOperateLeg(ctx, leg);
  if (leg.executorOrgId !== ctx.org.id) throw new AppError("FORBIDDEN", "Only the executing carrier can report location");
  if (!["DISPATCHED", "AT_PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_DELIVERY"].includes(leg.status)) throw conflict("Location sharing is only accepted while the trip is active");
  await ctx.db.insert(locationPings).values({
    shipmentId,
    legId: leg.id,
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracyM ?? null,
    source: input.source,
    label: input.label,
    reportedBy: ctx.user.id,
  });
  const [dest] = leg.toStopId ? await ctx.db.select().from(shipmentStops).where(eq(shipmentStops.id, leg.toStopId)) : [];
  let eta: Date | null = null;
  if (dest?.lat != null && dest?.lng != null) {
    eta = estimateEta({ lat: input.lat, lng: input.lng }, { lat: dest.lat, lng: dest.lng }).eta;
    await ctx.db.update(shipmentLegs).set({ etaAt: eta }).where(eq(shipmentLegs.id, leg.id));
  }
  return { ok: true, etaAt: eta };
}

/* ---------------------------------------------------------------- Exceptions */

export async function openException(ctx: Ctx, shipmentId: string, input: z.infer<typeof exceptionSchema>, evidence: Record<string, unknown> = {}) {
  requirePerm(ctx, "exception.manage");
  const access = await requireParty(ctx, shipmentId);
  const [ex] = await ctx.db
    .insert(shipmentExceptions)
    .values({
      shipmentId,
      legId: input.legId ?? null,
      vehicleId: input.vehicleId ?? null,
      type: input.type,
      severity: input.severity,
      title: input.title,
      description: input.description,
      evidence: { reportedBy: ctx.user.name, ...evidence },
      customerVisible: access.isCustomer ? true : input.customerVisible,
      openedByUserId: ctx.user.id,
      openedByOrgId: ctx.org.id,
      detectedBy: "USER",
    })
    .returning();
  await recordEvent(ctx, shipmentId, {
    type: "EXCEPTION_OPENED",
    title: `Exception: ${input.title}`,
    detail: { exceptionId: ex.id, type: input.type, severity: input.severity },
    customerTracking: input.customerVisible && ["DELAY"].includes(input.type),
    internal: !input.customerVisible && !access.isCustomer,
  });
  await audit(ctx, "exception.opened", "exception", ex.id, { after: { type: input.type, severity: input.severity } });
  return ex;
}

export async function updateException(ctx: Ctx, exceptionId: string, input: z.infer<typeof resolveExceptionSchema>) {
  requirePerm(ctx, "exception.manage");
  const [ex] = await ctx.db.select().from(shipmentExceptions).where(eq(shipmentExceptions.id, exceptionId));
  if (!ex) throw notFound("Exception");
  await requireParty(ctx, ex.shipmentId);
  if (ex.status === "RESOLVED") throw conflict("Exception already resolved");
  if (input.status === "RESOLVED" && !input.resolution) throw new AppError("VALIDATION_FAILED", "Describe how the exception was resolved");
  await ctx.db
    .update(shipmentExceptions)
    .set({ status: input.status, resolution: input.resolution ?? ex.resolution, resolvedAt: input.status === "RESOLVED" ? new Date() : null, assignedToUserId: ex.assignedToUserId ?? ctx.user.id })
    .where(eq(shipmentExceptions.id, ex.id));
  await recordEvent(ctx, ex.shipmentId, {
    type: input.status === "RESOLVED" ? "EXCEPTION_RESOLVED" : "EXCEPTION_ACKNOWLEDGED",
    title: `${input.status === "RESOLVED" ? "Resolved" : "Acknowledged"}: ${ex.title}`,
    detail: { exceptionId: ex.id, resolution: input.resolution ?? null },
  });
  await audit(ctx, `exception.${input.status.toLowerCase()}`, "exception", ex.id, { before: { status: ex.status }, after: { status: input.status } });
}

export function canSeeMargin(ctx: Ctx) {
  return can(ctx, "margin.view");
}
