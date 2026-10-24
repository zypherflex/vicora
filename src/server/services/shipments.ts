import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { ShipmentStatus } from "@/lib/domain";
import { geocoder } from "@/server/adapters/geocode";
import { can, requirePerm, type Ctx } from "@/server/authz/context";
import {
  charges,
  customsEntries,
  documentRequirements,
  documents,
  documentVersions,
  drivers,
  equipment,
  inspections,
  invoices,
  locationPings,
  messages,
  organizations,
  quoteInvitations,
  quoteLines,
  quotes,
  shipmentEvents,
  shipmentExceptions,
  shipmentItems,
  shipmentLegs,
  shipmentParties,
  shipments,
  shipmentStatusHistory,
  shipmentStops,
  tenders,
  trackingLinks,
  users,
  vehicles,
} from "@/server/db/schema";
import { AppError, badRequest } from "@/server/http/errors";
import type { CreateShipmentInput } from "@/server/validators";
import { audit, loadShipmentAccess, recordEvent, requireParty } from "./common";
import { transitionShipment } from "./status";

function legModeFor(serviceType: string, fromKind: string, toKind: string) {
  if (serviceType === "AUTO_TRANSPORT") return "AUTO_CARRIER" as const;
  if (fromKind === "RAIL_RAMP" && toKind === "RAIL_RAMP") return "RAIL" as const;
  if (fromKind === "PORT") return "DRAYAGE" as const;
  return "TRUCK" as const;
}

export async function createShipment(ctx: Ctx, input: CreateShipmentInput) {
  requirePerm(ctx, "shipment.create");
  if (ctx.org.type !== "SHIPPER") throw new AppError("FORBIDDEN", "Only shipper organizations can book shipments");

  const [{ n }] = await ctx.db.execute<{ n: string }>(sql`select nextval('shipment_ref_seq') as n`);
  const year = new Date().getUTCFullYear().toString().slice(2);
  const reference = `VCR-${year}-${String(n).padStart(6, "0")}`;

  const totalWeightLb = input.items.reduce((s, i) => s + i.weightLb, 0) || null;
  const totalPieces = input.items.reduce((s, i) => s + i.quantity, 0) || null;
  const intl = input.international ?? {};

  const [shipment] = await ctx.db
    .insert(shipments)
    .values({
      reference,
      ownerOrgId: ctx.org.id,
      createdBy: ctx.user.id,
      serviceType: input.serviceType,
      requiresCustoms: input.requiresCustoms,
      title: input.title,
      customerReference: input.customerReference,
      commodity: input.commodity,
      totalWeightLb,
      totalPieces,
      equipmentType:
        input.equipmentType ??
        (input.serviceType === "AUTO_TRANSPORT"
          ? input.vehicles.some((v) => v.transportType === "ENCLOSED")
            ? "CAR_CARRIER_ENCLOSED"
            : "CAR_CARRIER_OPEN"
          : null),
      accessorials: input.accessorials,
      hazmat: input.hazmat || input.items.some((i) => i.hazmat),
      temperatureMinF: input.temperatureMinF,
      temperatureMaxF: input.temperatureMaxF,
      specialInstructions: input.specialInstructions,
      currency: input.currency,
      targetBudgetMinor: input.targetBudgetMinor,
      quoteVisibility: input.quoteVisibility,
      portOfEntry: intl.portOfEntry ?? null,
      vesselVoyage: intl.vesselVoyage ?? null,
      containerNumber: intl.containerNumber ?? null,
      billOfLadingNumber: intl.billOfLadingNumber ?? null,
      countryOfOrigin: intl.countryOfOrigin ?? null,
      portEta: intl.portEta ?? null,
      isDemo: ctx.org.isDemo,
    })
    .returning();

  await ctx.db.insert(shipmentParties).values({ shipmentId: shipment.id, orgId: ctx.org.id, role: "CUSTOMER" });

  const stopRows = [];
  for (const [seq, s] of input.stops.entries()) {
    const geo = await geocoder().geocode(s);
    stopRows.push({
      shipmentId: shipment.id,
      seq,
      kind: s.kind,
      name: s.name,
      address1: s.address1,
      city: s.city,
      state: s.state,
      postalCode: s.postalCode ?? null,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      timezone: s.timezone ?? geo?.timezone ?? "America/Chicago",
      windowStart: s.windowStart ?? null,
      windowEnd: s.windowEnd ?? null,
      contactName: s.contactName,
      contactPhone: s.contactPhone,
      reference: s.reference,
      notes: s.notes,
    });
  }
  const stops = await ctx.db.insert(shipmentStops).values(stopRows).returning();

  if (input.items.length) await ctx.db.insert(shipmentItems).values(input.items.map((i) => ({ ...i, shipmentId: shipment.id })));
  if (input.vehicles.length) await ctx.db.insert(vehicles).values(input.vehicles.map((v) => ({ ...v, shipmentId: shipment.id })));

  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    legs.push({
      shipmentId: shipment.id,
      seq: i,
      mode: legModeFor(input.serviceType, stops[i].kind, stops[i + 1].kind),
      fromStopId: stops[i].id,
      toStopId: stops[i + 1].id,
      currency: input.currency,
      plannedPickupAt: stops[i].windowStart,
      plannedDeliveryAt: stops[i + 1].windowEnd ?? stops[i + 1].windowStart,
    });
  }
  await ctx.db.insert(shipmentLegs).values(legs);

  if (input.quoteVisibility === "INVITED" && input.invitedProviderOrgIds.length) {
    await ctx.db
      .insert(quoteInvitations)
      .values(input.invitedProviderOrgIds.map((p) => ({ shipmentId: shipment.id, providerOrgId: p })))
      .onConflictDoNothing();
  }

  await ctx.db.insert(shipmentStatusHistory).values({ shipmentId: shipment.id, toStatus: "DRAFT", actorUserId: ctx.user.id, actorOrgId: ctx.org.id });
  await recordEvent(ctx, shipment.id, { type: "CREATED", title: "Shipment request created", detail: { reference } });
  await audit(ctx, "shipment.created", "shipment", shipment.id, { after: { reference, serviceType: input.serviceType } });

  if (input.submit) await requestQuotes(ctx, shipment.id);
  return { id: shipment.id, reference };
}

export async function requestQuotes(ctx: Ctx, shipmentId: string) {
  requirePerm(ctx, "quote.request");
  const access = await requireParty(ctx, shipmentId);
  if (!access.isCustomer) throw new AppError("FORBIDDEN", "Only the customer can request quotes");
  await transitionShipment(ctx, access, "QUOTE_REQUESTED", { reason: "Quotes requested" });
  await recordEvent(ctx, shipmentId, { type: "QUOTES_REQUESTED", title: "Quotes requested from providers", customerTracking: false });
}

export async function changeStatus(ctx: Ctx, shipmentId: string, to: ShipmentStatus, reason: string | null) {
  requirePerm(ctx, "shipment.update");
  const access = await requireParty(ctx, shipmentId);
  if (to === "CANCELLED") requirePerm(ctx, "shipment.cancel");
  await transitionShipment(ctx, access, to, { reason });
  if (to === "CANCELLED") {
    await ctx.db
      .update(quotes)
      .set({ status: "DECLINED" })
      .where(and(eq(quotes.shipmentId, shipmentId), eq(quotes.status, "SUBMITTED")));
  }
  return access.shipment;
}

export interface ShipmentListFilters {
  q?: string;
  status?: ShipmentStatus;
  serviceType?: string;
  limit?: number;
}

/** Shipments where the current org is a party. RLS guarantees isolation; the WHERE clause narrows to parties. */
export async function listShipments(ctx: Ctx, f: ShipmentListFilters = {}) {
  requirePerm(ctx, "shipment.read");
  const where: SQL[] = [sql`app_is_party(${shipments.id})`];
  if (f.status) where.push(eq(shipments.status, f.status));
  if (f.serviceType) where.push(eq(shipments.serviceType, f.serviceType as never));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(shipments.reference, like),
        ilike(shipments.title, like),
        ilike(shipments.customerReference, like),
        ilike(shipments.containerNumber, like),
        sql`exists (select 1 from shipment_vehicles v where v.shipment_id = ${shipments.id} and v.vin ilike ${like})`,
        sql`exists (select 1 from shipment_stops s where s.shipment_id = ${shipments.id} and (s.city ilike ${like} or s.name ilike ${like}))`,
      )!,
    );
  }
  const rows = await ctx.db
    .select()
    .from(shipments)
    .where(and(...where))
    .orderBy(desc(shipments.updatedAt))
    .limit(f.limit ?? 50);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [stops, legs, orgRows, pings, openEx] = await Promise.all([
    ctx.db.select().from(shipmentStops).where(inArray(shipmentStops.shipmentId, ids)).orderBy(asc(shipmentStops.seq)),
    ctx.db.select().from(shipmentLegs).where(inArray(shipmentLegs.shipmentId, ids)).orderBy(asc(shipmentLegs.seq)),
    ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations),
    ctx.db
      .selectDistinctOn([locationPings.shipmentId])
      .from(locationPings)
      .where(inArray(locationPings.shipmentId, ids))
      .orderBy(locationPings.shipmentId, desc(locationPings.recordedAt)),
    ctx.db
      .select({ shipmentId: shipmentExceptions.shipmentId, n: sql<number>`count(*)::int` })
      .from(shipmentExceptions)
      .where(and(inArray(shipmentExceptions.shipmentId, ids), inArray(shipmentExceptions.status, ["OPEN", "ACKNOWLEDGED"])))
      .groupBy(shipmentExceptions.shipmentId),
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.name]));
  return rows.map((s) => {
    const st = stops.filter((x) => x.shipmentId === s.id);
    const lg = legs.filter((x) => x.shipmentId === s.id);
    return {
      ...s,
      origin: st[0] ?? null,
      destination: st[st.length - 1] ?? null,
      stops: st,
      legs: lg,
      customerName: orgName.get(s.ownerOrgId) ?? "—",
      providerName: s.primaryProviderOrgId ? orgName.get(s.primaryProviderOrgId) ?? null : null,
      executorNames: [...new Set(lg.map((l) => (l.executorOrgId ? orgName.get(l.executorOrgId) : null)).filter(Boolean))] as string[],
      lastPing: pings.find((p) => p.shipmentId === s.id) ?? null,
      openExceptions: openEx.find((e) => e.shipmentId === s.id)?.n ?? 0,
      isCustomer: s.ownerOrgId === ctx.org.id,
    };
  });
}

/**
 * The shipment digital twin: one linked record with every related entity the caller may see.
 * Row-level security filters rows; this function additionally strips fields by role
 * (e.g. carrier rates and provider cost estimates are never returned to the customer).
 */
export async function getShipmentTwin(ctx: Ctx, shipmentId: string) {
  requirePerm(ctx, "shipment.read");
  const access = await loadShipmentAccess(ctx, shipmentId);
  const s = access.shipment;
  const seeMargin = can(ctx, "margin.view") && (access.isProvider || access.isExecutor);

  const [stops, items, legs, vehicleRows, quoteRows, history, events, docs, pings, exceptions, msgs, chargeRows, invoiceRows, requirements, links, customs, parties, tenderRows, inspectionRows] =
    await Promise.all([
      ctx.db.select().from(shipmentStops).where(eq(shipmentStops.shipmentId, s.id)).orderBy(asc(shipmentStops.seq)),
      ctx.db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, s.id)),
      ctx.db.select().from(shipmentLegs).where(eq(shipmentLegs.shipmentId, s.id)).orderBy(asc(shipmentLegs.seq)),
      ctx.db.select().from(vehicles).where(eq(vehicles.shipmentId, s.id)),
      ctx.db.select().from(quotes).where(eq(quotes.shipmentId, s.id)).orderBy(asc(quotes.totalMinor)),
      access.previewOnly ? [] : ctx.db.select().from(shipmentStatusHistory).where(eq(shipmentStatusHistory.shipmentId, s.id)).orderBy(desc(shipmentStatusHistory.changedAt)),
      access.previewOnly ? [] : ctx.db.select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, s.id)).orderBy(desc(shipmentEvents.occurredAt)).limit(300),
      access.previewOnly
        ? []
        : ctx.db
            .select({ doc: documents, version: documentVersions })
            .from(documents)
            .leftJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion)))
            .where(and(eq(documents.shipmentId, s.id), sql`${documents.deletedAt} is null`))
            .orderBy(desc(documents.createdAt)),
      access.previewOnly ? [] : ctx.db.select().from(locationPings).where(eq(locationPings.shipmentId, s.id)).orderBy(desc(locationPings.recordedAt)).limit(200),
      access.previewOnly ? [] : ctx.db.select().from(shipmentExceptions).where(eq(shipmentExceptions.shipmentId, s.id)).orderBy(desc(shipmentExceptions.createdAt)),
      access.previewOnly ? [] : ctx.db.select().from(messages).where(eq(messages.shipmentId, s.id)).orderBy(asc(messages.createdAt)),
      access.previewOnly ? [] : ctx.db.select().from(charges).where(eq(charges.shipmentId, s.id)).orderBy(asc(charges.createdAt)),
      access.previewOnly ? [] : ctx.db.select().from(invoices).where(eq(invoices.shipmentId, s.id)),
      access.previewOnly ? [] : ctx.db.select().from(documentRequirements).where(eq(documentRequirements.shipmentId, s.id)),
      access.previewOnly ? [] : ctx.db.select().from(trackingLinks).where(eq(trackingLinks.shipmentId, s.id)).orderBy(desc(trackingLinks.createdAt)),
      access.previewOnly ? [] : ctx.db.select().from(customsEntries).where(eq(customsEntries.shipmentId, s.id)),
      ctx.db.select().from(shipmentParties).where(eq(shipmentParties.shipmentId, s.id)),
      ctx.db.select().from(tenders).where(eq(tenders.shipmentId, s.id)).orderBy(desc(tenders.createdAt)),
      access.previewOnly ? [] : ctx.db.select().from(inspections).where(eq(inspections.shipmentId, s.id)).orderBy(asc(inspections.performedAt)),
    ]);

  const lineRows = quoteRows.length
    ? await ctx.db.select().from(quoteLines).where(inArray(quoteLines.quoteId, quoteRows.map((q) => q.id)))
    : [];

  const orgIds = new Set<string>([s.ownerOrgId, ...parties.map((p) => p.orgId), ...quoteRows.map((q) => q.providerOrgId)]);
  for (const l of legs) if (l.executorOrgId) orgIds.add(l.executorOrgId);
  for (const t of tenderRows) orgIds.add(t.toOrgId);
  const orgRows = orgIds.size
    ? await ctx.db.select({ id: organizations.id, name: organizations.name, type: organizations.type }).from(organizations).where(inArray(organizations.id, [...orgIds]))
    : [];
  const userIds = new Set<string>();
  for (const e of events) if (e.actorUserId) userIds.add(e.actorUserId);
  for (const h of history) if (h.actorUserId) userIds.add(h.actorUserId);
  for (const m of msgs) if (m.authorUserId) userIds.add(m.authorUserId);
  const userRows = userIds.size ? await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])) : [];
  const driverIds = legs.map((l) => l.driverId).filter(Boolean) as string[];
  const equipIds = legs.map((l) => l.equipmentId).filter(Boolean) as string[];
  const [driverRows, equipRows] = await Promise.all([
    driverIds.length ? ctx.db.select({ id: drivers.id, name: drivers.name, phone: drivers.phone, userId: drivers.userId }).from(drivers).where(inArray(drivers.id, driverIds)) : [],
    equipIds.length ? ctx.db.select({ id: equipment.id, unitNumber: equipment.unitNumber, type: equipment.type }).from(equipment).where(inArray(equipment.id, equipIds)) : [],
  ]);

  const legsOut = legs.map((l) => ({
    ...l,
    // Carrier rate is a cost: visible to the managing provider and the executing carrier only.
    carrierRateMinor: l.managerOrgId === ctx.org.id || l.executorOrgId === ctx.org.id ? l.carrierRateMinor : null,
    driver: driverRows.find((d) => d.id === l.driverId) ?? null,
    equipment: equipRows.find((e) => e.id === l.equipmentId) ?? null,
  }));

  const quotesOut = quoteRows.map((q) => ({
    ...q,
    estimatedCostMinor: q.providerOrgId === ctx.org.id ? q.estimatedCostMinor : null,
    lines: lineRows.filter((l) => l.quoteId === q.id),
  }));

  const receivables = chargeRows.filter((c) => c.kind === "RECEIVABLE");
  const payablesC = chargeRows.filter((c) => c.kind === "PAYABLE");
  const revenue = receivables.filter((c) => c.status === "CONFIRMED").reduce((a, c) => a + c.amountMinor, 0);
  const cost = payablesC.filter((c) => c.status !== "VOID").reduce((a, c) => a + c.amountMinor, 0);

  return {
    access: { roles: access.roles, isCustomer: access.isCustomer, isProvider: access.isProvider, isExecutor: access.isExecutor, isCustomsBroker: access.isCustomsBroker, previewOnly: access.previewOnly },
    shipment: s,
    stops,
    items,
    legs: legsOut,
    vehicles: vehicleRows,
    quotes: quotesOut,
    tenders: tenderRows,
    history,
    events,
    documents: docs.map((d) => ({ ...d.doc, version: d.version })),
    pings,
    exceptions,
    messages: msgs,
    charges: chargeRows,
    invoices: invoiceRows,
    requirements,
    trackingLinks: links.map(({ tokenHash: _t, ...l }) => l),
    customs,
    inspections: inspectionRows,
    parties,
    orgs: Object.fromEntries(orgRows.map((o) => [o.id, o])),
    users: Object.fromEntries(userRows.map((u) => [u.id, u.name])),
    finance: seeMargin ? { revenueMinor: revenue, costMinor: cost, marginMinor: revenue - cost } : null,
  };
}
export type ShipmentTwin = Awaited<ReturnType<typeof getShipmentTwin>>;

export function assertNotTerminal(status: ShipmentStatus) {
  if (status === "CANCELLED" || status === "COMPLETED") throw badRequest("This shipment is closed");
}
