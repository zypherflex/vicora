import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { requirePerm, type Ctx } from "@/server/authz/context";
import {
  documents,
  drivers,
  equipment,
  inspectionDamages,
  inspections,
  memberships,
  shipmentExceptions,
  shipmentLegs,
  shipments,
  shipmentStops,
  trips,
  users,
  vehicles,
} from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type { driverSchema, equipmentSchema, inspectionSchema, tripSchema } from "@/server/validators";
import { audit, recordEvent, requireParty } from "./common";

export async function listFleet(ctx: Ctx) {
  requirePerm(ctx, "fleet.read");
  const [d, e, t] = await Promise.all([
    ctx.db.select().from(drivers).where(eq(drivers.orgId, ctx.org.id)).orderBy(asc(drivers.name)),
    ctx.db.select().from(equipment).where(eq(equipment.orgId, ctx.org.id)).orderBy(asc(equipment.unitNumber)),
    ctx.db.select().from(trips).where(eq(trips.orgId, ctx.org.id)).orderBy(desc(trips.createdAt)),
  ]);
  const tripIds = t.map((x) => x.id);
  const loaded = tripIds.length
    ? await ctx.db
        .select({ tripId: vehicles.tripId, id: vehicles.id, vin: vehicles.vin, year: vehicles.year, make: vehicles.make, model: vehicles.model, status: vehicles.status, shipmentId: vehicles.shipmentId })
        .from(vehicles)
        .where(inArray(vehicles.tripId, tripIds))
    : [];
  return { drivers: d, equipment: e, trips: t.map((x) => ({ ...x, vehicles: loaded.filter((v) => v.tripId === x.id) })) };
}

export async function addDriver(ctx: Ctx, input: z.infer<typeof driverSchema>) {
  requirePerm(ctx, "fleet.manage");
  let userId: string | null = null;
  if (input.email) {
    // Link to an existing member of this org with the DRIVER role, so the driver app can be used.
    const [m] = await ctx.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, ctx.org.id), eq(users.email, input.email)));
    if (!m) throw new AppError("VALIDATION_FAILED", "Invite this person to your team with the Driver role first, then link them here");
    userId = m.userId;
  }
  const [row] = await ctx.db
    .insert(drivers)
    .values({ orgId: ctx.org.id, userId, name: input.name, phone: input.phone, licenseState: input.licenseState ?? null, licenseExpiresAt: input.licenseExpiresAt ?? null })
    .returning();
  await audit(ctx, "fleet.driver_added", "driver", row.id);
  return row;
}

export async function addEquipment(ctx: Ctx, input: z.infer<typeof equipmentSchema>) {
  requirePerm(ctx, "fleet.manage");
  const isCarHauler = input.type.startsWith("CAR_CARRIER");
  if (isCarHauler && !input.vehicleCapacity) throw new AppError("VALIDATION_FAILED", "Car carriers need a vehicle capacity");
  const [row] = await ctx.db.insert(equipment).values({ orgId: ctx.org.id, ...input, currentState: input.currentState ?? null }).returning();
  await audit(ctx, "fleet.equipment_added", "equipment", row.id);
  return row;
}

export async function setEquipmentStatus(ctx: Ctx, id: string, status: "AVAILABLE" | "IN_USE" | "MAINTENANCE") {
  requirePerm(ctx, "fleet.manage");
  const res = await ctx.db.update(equipment).set({ status }).where(and(eq(equipment.id, id), eq(equipment.orgId, ctx.org.id))).returning({ id: equipment.id });
  if (!res.length) throw notFound("Equipment");
  await audit(ctx, "fleet.equipment_status", "equipment", id, { after: { status } });
}

/* ---------------------------------------------------------------- Auto transport trips */

/** Vehicles on shipments this org executes that are not yet on a trip. */
export async function unassignedVehicles(ctx: Ctx) {
  requirePerm(ctx, "fleet.read");
  return ctx.db
    .select({ id: vehicles.id, vin: vehicles.vin, year: vehicles.year, make: vehicles.make, model: vehicles.model, operable: vehicles.operable, transportType: vehicles.transportType, shipmentId: vehicles.shipmentId, reference: shipments.reference, status: vehicles.status })
    .from(vehicles)
    .innerJoin(shipments, eq(shipments.id, vehicles.shipmentId))
    .where(
      and(
        isNull(vehicles.tripId),
        inArray(vehicles.status, ["PENDING", "ASSIGNED"]),
        sql`exists (select 1 from shipment_legs l where l.shipment_id = ${vehicles.shipmentId} and l.executor_org_id = ${ctx.org.id})`,
      ),
    );
}

export async function createTrip(ctx: Ctx, input: z.infer<typeof tripSchema>) {
  requirePerm(ctx, "dispatch.manage");
  const [unit] = await ctx.db.select().from(equipment).where(and(eq(equipment.id, input.equipmentId), eq(equipment.orgId, ctx.org.id)));
  if (!unit) throw notFound("Equipment");
  if (!unit.vehicleCapacity) throw new AppError("VALIDATION_FAILED", "Trips need a car carrier with a vehicle capacity");
  if (input.driverId) {
    const [d] = await ctx.db.select().from(drivers).where(and(eq(drivers.id, input.driverId), eq(drivers.orgId, ctx.org.id)));
    if (!d) throw notFound("Driver");
  }
  const [trip] = await ctx.db
    .insert(trips)
    .values({ orgId: ctx.org.id, name: input.name, driverId: input.driverId ?? null, equipmentId: unit.id, capacity: unit.vehicleCapacity, plannedStart: input.plannedStart ?? null })
    .returning();
  if (input.vehicleIds.length) await assignVehiclesToTrip(ctx, trip.id, input.vehicleIds);
  await audit(ctx, "trip.created", "trip", trip.id);
  return trip;
}

/** Capacity-checked assignment. Enclosed vehicles require an enclosed carrier. */
export async function assignVehiclesToTrip(ctx: Ctx, tripId: string, vehicleIds: string[]) {
  requirePerm(ctx, "dispatch.manage");
  const [trip] = await ctx.db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.orgId, ctx.org.id)));
  if (!trip) throw notFound("Trip");
  await ctx.db.execute(sql`select id from trips where id = ${trip.id} for update`);
  const [unit] = trip.equipmentId ? await ctx.db.select().from(equipment).where(eq(equipment.id, trip.equipmentId)) : [];
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(eq(vehicles.tripId, trip.id));
  const eligible = await unassignedVehicles(ctx);
  const chosen = eligible.filter((v) => vehicleIds.includes(v.id));
  if (chosen.length !== vehicleIds.length) throw new AppError("VALIDATION_FAILED", "Some vehicles are not available for this trip");
  if (n + chosen.length > trip.capacity) throw conflict(`Capacity exceeded: ${n} loaded + ${chosen.length} requested > ${trip.capacity} slots`);
  if (unit?.type === "CAR_CARRIER_OPEN" && chosen.some((v) => v.transportType === "ENCLOSED")) throw conflict("Enclosed-transport vehicles cannot be loaded on an open carrier");
  await ctx.db.update(vehicles).set({ tripId: trip.id, status: "ASSIGNED" }).where(inArray(vehicles.id, vehicleIds));
  for (const sid of [...new Set(chosen.map((v) => v.shipmentId))]) {
    await recordEvent(ctx, sid, { type: "TRIP_PLANNED", title: `Vehicle(s) planned on trip "${trip.name}"`, detail: { tripId: trip.id, vehicleIds: chosen.filter((v) => v.shipmentId === sid).map((v) => v.id) } });
  }
  return { loaded: n + chosen.length, capacity: trip.capacity };
}

/* ---------------------------------------------------------------- Inspections (electronic condition reports) */

export async function recordInspection(ctx: Ctx, shipmentId: string, input: z.infer<typeof inspectionSchema>) {
  requirePerm(ctx, "inspection.perform");
  const access = await requireParty(ctx, shipmentId);
  if (!access.isExecutor) throw new AppError("FORBIDDEN", "Only the transporting carrier records inspections");
  const [vehicle] = await ctx.db.select().from(vehicles).where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.shipmentId, shipmentId)));
  if (!vehicle) throw notFound("Vehicle");
  const docIds = [...input.photoDocumentIds, ...input.damages.map((d) => d.photoDocumentId).filter(Boolean), input.signatureDocumentId].filter(Boolean) as string[];
  if (docIds.length) {
    const found = await ctx.db.select({ id: documents.id }).from(documents).where(and(inArray(documents.id, docIds), eq(documents.shipmentId, shipmentId)));
    if (found.length !== new Set(docIds).size) throw new AppError("VALIDATION_FAILED", "Photos and signatures must be uploaded to this shipment first");
  }
  if (input.kind === "DELIVERY") {
    const [pickup] = await ctx.db.select({ id: inspections.id }).from(inspections).where(and(eq(inspections.vehicleId, vehicle.id), eq(inspections.kind, "PICKUP")));
    if (!pickup) throw conflict("Record the pickup inspection before the delivery inspection");
  }
  const [insp] = await ctx.db
    .insert(inspections)
    .values({
      shipmentId,
      vehicleId: vehicle.id,
      orgId: ctx.org.id,
      kind: input.kind,
      performedBy: ctx.user.id,
      odometer: input.odometer ?? null,
      notes: input.notes,
      signerName: input.signerName,
      signatureDocumentId: input.signatureDocumentId ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    })
    .returning();
  if (input.damages.length) await ctx.db.insert(inspectionDamages).values(input.damages.map((d) => ({ ...d, inspectionId: insp.id })));

  let newDamage: { area: string; damageType: string; severity: string }[] = [];
  if (input.kind === "DELIVERY") newDamage = await compareConditionReports(ctx, vehicle.id);
  await recordEvent(ctx, shipmentId, {
    type: "INSPECTION",
    title: `${input.kind === "PICKUP" ? "Pickup" : "Delivery"} inspection: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${input.damages.length} noted condition item${input.damages.length === 1 ? "" : "s"})`,
    detail: { inspectionId: insp.id, vehicleId: vehicle.id, photoDocumentIds: input.photoDocumentIds, damages: input.damages.length },
  });
  if (newDamage.length) {
    const [ex] = await ctx.db
      .insert(shipmentExceptions)
      .values({
        shipmentId,
        vehicleId: vehicle.id,
        type: "DAMAGE",
        severity: newDamage.some((d) => d.severity === "MAJOR") ? "HIGH" : "MEDIUM",
        title: `New damage at delivery: ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        description: newDamage.map((d) => `${d.area}: ${d.damageType.toLowerCase()} (${d.severity.toLowerCase()})`).join("; "),
        evidence: { rule: "delivery_vs_pickup_condition", vin: vehicle.vin, deliveryInspectionId: insp.id, newDamage },
        customerVisible: true,
        openedByUserId: ctx.user.id,
        openedByOrgId: ctx.org.id,
        detectedBy: "RULE",
      })
      .returning();
    await ctx.db.update(vehicles).set({ status: "DAMAGE_REPORTED" }).where(eq(vehicles.id, vehicle.id));
    await recordEvent(ctx, shipmentId, { type: "EXCEPTION_OPENED", title: `Damage exception opened for VIN …${vehicle.vin.slice(-6)}`, detail: { exceptionId: ex.id } });
  }
  await audit(ctx, "inspection.recorded", "inspection", insp.id, { after: { kind: input.kind, damages: input.damages.length } });
  return { inspection: insp, newDamage };
}

/** Damage present at delivery but not on the pickup report (same area + type). */
export async function compareConditionReports(ctx: Ctx, vehicleId: string) {
  const reports = await ctx.db.select().from(inspections).where(eq(inspections.vehicleId, vehicleId)).orderBy(asc(inspections.performedAt));
  const pickup = reports.filter((r) => r.kind === "PICKUP").at(-1);
  const delivery = reports.filter((r) => r.kind === "DELIVERY").at(-1);
  if (!pickup || !delivery) return [];
  const dmg = await ctx.db.select().from(inspectionDamages).where(inArray(inspectionDamages.inspectionId, [pickup.id, delivery.id]));
  return diffDamage(
    dmg.filter((d) => d.inspectionId === pickup.id),
    dmg.filter((d) => d.inspectionId === delivery.id),
  );
}

export function diffDamage<T extends { area: string; damageType: string; severity: string }>(pickup: T[], delivery: T[]): T[] {
  const key = (d: T) => `${d.area.trim().toLowerCase()}|${d.damageType}`;
  const before = new Set(pickup.map(key));
  return delivery.filter((d) => !before.has(key(d)));
}

/* ---------------------------------------------------------------- Driver app */

export async function driverTrips(ctx: Ctx) {
  const mine = await ctx.db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.orgId, ctx.org.id), eq(drivers.userId, ctx.user.id)));
  if (!mine.length) return [];
  const legs = await ctx.db
    .select()
    .from(shipmentLegs)
    .where(and(inArray(shipmentLegs.driverId, mine.map((d) => d.id)), inArray(shipmentLegs.status, ["DISPATCHED", "AT_PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_DELIVERY", "DELIVERED"])))
    .orderBy(asc(shipmentLegs.plannedPickupAt));
  if (!legs.length) return [];
  const sids = [...new Set(legs.map((l) => l.shipmentId))];
  const [ships, stops, vehs] = await Promise.all([
    ctx.db.select().from(shipments).where(inArray(shipments.id, sids)),
    ctx.db.select().from(shipmentStops).where(inArray(shipmentStops.shipmentId, sids)),
    ctx.db.select().from(vehicles).where(inArray(vehicles.shipmentId, sids)),
  ]);
  return legs.map((l) => ({
    leg: l,
    shipment: ships.find((s) => s.id === l.shipmentId)!,
    from: stops.find((s) => s.id === l.fromStopId) ?? null,
    to: stops.find((s) => s.id === l.toStopId) ?? null,
    vehicles: vehs.filter((v) => v.shipmentId === l.shipmentId),
  }));
}
