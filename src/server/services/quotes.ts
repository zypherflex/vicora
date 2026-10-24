import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { PROVIDER_ORG_TYPES, type ServiceType } from "@/lib/domain";
import { lineAmount } from "@/lib/money";
import { requirePerm, type Ctx } from "@/server/authz/context";
import { charges, organizations, quoteLines, quotes, shipmentLegs, shipmentParties, shipments, shipmentStops } from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type { z } from "zod";
import type { submitQuoteSchema } from "@/server/validators";
import { audit, enqueue, loadShipmentAccess, recordEvent } from "./common";
import { transitionShipment } from "./status";

/** Which service types each provider type quotes on the load board. */
const BOARD_SERVICES: Record<string, ServiceType[]> = {
  FREIGHT_BROKER: ["FTL", "LTL", "INTERMODAL", "PORT_TO_DOOR", "AUTO_TRANSPORT"],
  CARRIER: ["FTL", "LTL", "PORT_TO_DOOR", "INTERMODAL"],
  AUTO_TRANSPORT: ["AUTO_TRANSPORT"],
};

export async function loadBoard(ctx: Ctx) {
  requirePerm(ctx, "loadboard.read");
  const services = BOARD_SERVICES[ctx.org.type] ?? [];
  if (!services.length) return [];
  const rows = await ctx.db
    .select()
    .from(shipments)
    .where(and(eq(shipments.status, "QUOTE_REQUESTED"), inArray(shipments.serviceType, services), ne(shipments.ownerOrgId, ctx.org.id)))
    .orderBy(desc(shipments.updatedAt))
    .limit(100);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [stops, mine, counts] = await Promise.all([
    ctx.db.select().from(shipmentStops).where(inArray(shipmentStops.shipmentId, ids)).orderBy(asc(shipmentStops.seq)),
    ctx.db.select().from(quotes).where(and(inArray(quotes.shipmentId, ids), eq(quotes.providerOrgId, ctx.org.id))),
    ctx.db.execute<{ shipment_id: string; vehicles: number }>(
      sql`select shipment_id, count(*)::int as vehicles from shipment_vehicles where shipment_id in ${ids} group by shipment_id`,
    ),
  ]);
  return rows.map((s) => {
    const st = stops.filter((x) => x.shipmentId === s.id);
    return {
      ...s,
      origin: st[0],
      destination: st[st.length - 1],
      myQuote: mine.filter((q) => q.shipmentId === s.id).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null,
      vehicleCount: counts.find((c) => c.shipment_id === s.id)?.vehicles ?? 0,
    };
  });
}

export function computeQuoteLines(lines: z.infer<typeof submitQuoteSchema>["lines"]) {
  const out = lines.map((l) => ({ ...l, amountMinor: lineAmount(l.quantityMilli, l.unitAmountMinor) }));
  const totalMinor = out.reduce((s, l) => s + l.amountMinor, 0);
  if (totalMinor <= 0) throw new AppError("VALIDATION_FAILED", "Quote total must be greater than zero");
  return { lines: out, totalMinor };
}

export async function submitQuote(ctx: Ctx, shipmentId: string, input: z.infer<typeof submitQuoteSchema>) {
  requirePerm(ctx, "quote.submit");
  if (!PROVIDER_ORG_TYPES.includes(ctx.org.type)) throw new AppError("FORBIDDEN", "Only transportation providers can quote shipments");
  const access = await loadShipmentAccess(ctx, shipmentId);
  if (access.isCustomer) throw new AppError("FORBIDDEN", "You cannot quote your own shipment");
  if (access.shipment.status !== "QUOTE_REQUESTED") throw conflict("This shipment is not accepting quotes");
  if (input.currency !== access.shipment.currency)
    throw new AppError("VALIDATION_FAILED", `Quotes for this shipment must be in ${access.shipment.currency}`);

  const { lines, totalMinor } = computeQuoteLines(input.lines);
  // A provider has at most one live quote per shipment: a new submission supersedes the previous one.
  await ctx.db
    .update(quotes)
    .set({ status: "WITHDRAWN" })
    .where(and(eq(quotes.shipmentId, shipmentId), eq(quotes.providerOrgId, ctx.org.id), eq(quotes.status, "SUBMITTED")));
  const [quote] = await ctx.db
    .insert(quotes)
    .values({
      shipmentId,
      providerOrgId: ctx.org.id,
      currency: input.currency,
      totalMinor,
      estimatedCostMinor: input.estimatedCostMinor ?? null,
      transitDays: input.transitDays ?? null,
      validUntil: input.validUntil ?? new Date(Date.now() + 3 * 86400_000),
      notes: input.notes,
      submittedBy: ctx.user.id,
    })
    .returning();
  await ctx.db.insert(quoteLines).values(lines.map((l) => ({ quoteId: quote.id, code: l.code, description: l.description, quantityMilli: l.quantityMilli, unitAmountMinor: l.unitAmountMinor, amountMinor: l.amountMinor })));
  // The event is internal to the provider; the customer is notified separately without exposing competitors.
  await recordEvent(ctx, shipmentId, { type: "QUOTE_SUBMITTED", title: `Quote submitted by ${ctx.org.name}`, internal: true, detail: { quoteId: quote.id } });
  await enqueue(ctx.db, "notify.org", {
    orgId: access.shipment.ownerOrgId,
    type: "QUOTE_SUBMITTED",
    title: `New quote on ${access.shipment.reference}`,
    body: `${ctx.org.name} submitted a quote.`,
    link: `/shipments/${shipmentId}?tab=quotes`,
    shipmentId,
  });
  await audit(ctx, "quote.submitted", "quote", quote.id, { after: { shipmentId, totalMinor, currency: input.currency } });
  return quote;
}

export async function withdrawQuote(ctx: Ctx, quoteId: string) {
  requirePerm(ctx, "quote.submit");
  const [q] = await ctx.db.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.providerOrgId, ctx.org.id)));
  if (!q) throw notFound("Quote");
  if (q.status !== "SUBMITTED") throw conflict("Only submitted quotes can be withdrawn");
  await ctx.db.update(quotes).set({ status: "WITHDRAWN" }).where(eq(quotes.id, quoteId));
  await audit(ctx, "quote.withdrawn", "quote", quoteId);
}

/**
 * Accept a quote. Concurrency-safe: the shipment row is locked, so two simultaneous
 * acceptances cannot both succeed. Re-accepting the already accepted quote is a no-op.
 */
export async function acceptQuote(ctx: Ctx, quoteId: string) {
  requirePerm(ctx, "quote.accept");
  const [q] = await ctx.db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!q) throw notFound("Quote");
  await ctx.db.execute(sql`select id from shipments where id = ${q.shipmentId} for update`);
  const access = await loadShipmentAccess(ctx, q.shipmentId);
  if (!access.isCustomer) throw notFound("Quote");
  const s = access.shipment;
  if (s.acceptedQuoteId === q.id) return { shipmentId: s.id, alreadyAccepted: true };
  if (s.status !== "QUOTE_REQUESTED") throw conflict("This shipment is no longer accepting quotes");
  if (q.status !== "SUBMITTED") throw conflict(`This quote is ${q.status.toLowerCase()} and cannot be accepted`);
  if (q.validUntil && q.validUntil < new Date()) {
    await ctx.db.update(quotes).set({ status: "EXPIRED" }).where(eq(quotes.id, q.id));
    throw conflict("This quote has expired. Ask the provider for an updated quote.");
  }
  if (q.currency !== s.currency) throw conflict("Quote currency does not match the shipment currency");

  const [provider] = await ctx.db.select().from(organizations).where(eq(organizations.id, q.providerOrgId));
  if (!provider || provider.status !== "ACTIVE") throw conflict("This provider is not currently active");

  const now = new Date();
  await ctx.db.update(quotes).set({ status: "ACCEPTED", acceptedBy: ctx.user.id, acceptedAt: now }).where(eq(quotes.id, q.id));
  await ctx.db
    .update(quotes)
    .set({ status: "DECLINED" })
    .where(and(eq(quotes.shipmentId, s.id), ne(quotes.id, q.id), eq(quotes.status, "SUBMITTED")));
  await ctx.db.update(shipments).set({ acceptedQuoteId: q.id, primaryProviderOrgId: q.providerOrgId, updatedAt: now }).where(eq(shipments.id, s.id));
  await ctx.db.insert(shipmentParties).values({ shipmentId: s.id, orgId: q.providerOrgId, role: "PRIMARY_PROVIDER" }).onConflictDoNothing();

  // Accepted quote lines become confirmed receivable charges (provider → customer).
  const lines = await ctx.db.select().from(quoteLines).where(eq(quoteLines.quoteId, q.id));
  await ctx.db.insert(charges).values(
    lines.map((l) => ({
      shipmentId: s.id,
      kind: "RECEIVABLE" as const,
      billerOrgId: q.providerOrgId,
      billToOrgId: s.ownerOrgId,
      code: l.code,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitAmountMinor: l.unitAmountMinor,
      amountMinor: l.amountMinor,
      currency: q.currency,
      status: "CONFIRMED" as const,
      source: "QUOTE" as const,
      sourceId: q.id,
      createdBy: ctx.user.id,
      confirmedBy: ctx.user.id,
      confirmedAt: now,
    })),
  );

  // Asset-based providers execute the legs themselves; brokers will tender them to carriers.
  const selfExecuting = provider.type === "CARRIER" || provider.type === "AUTO_TRANSPORT";
  await ctx.db
    .update(shipmentLegs)
    .set(selfExecuting ? { managerOrgId: provider.id, executorOrgId: provider.id, status: "ACCEPTED" } : { managerOrgId: provider.id })
    .where(eq(shipmentLegs.shipmentId, s.id));
  if (selfExecuting) await ctx.db.insert(shipmentParties).values({ shipmentId: s.id, orgId: provider.id, role: "CARRIER" }).onConflictDoNothing();

  await transitionShipment(ctx, access, "BOOKED", { actor: "SYSTEM", reason: `Accepted quote from ${provider.name}` });
  await recordEvent(ctx, s.id, {
    type: "QUOTE_ACCEPTED",
    title: `Booked with ${provider.name}`,
    detail: { quoteId: q.id, providerOrgId: provider.id },
    customerTracking: true,
  });
  if (selfExecuting) await transitionShipment(ctx, access, "ASSIGNED", { actor: "SYSTEM", reason: "Provider operates its own equipment" });
  await audit(ctx, "quote.accepted", "quote", q.id, { after: { shipmentId: s.id, totalMinor: q.totalMinor, currency: q.currency } });
  return { shipmentId: s.id, alreadyAccepted: false };
}

export async function myQuotes(ctx: Ctx) {
  requirePerm(ctx, "quote.submit");
  return ctx.db.select().from(quotes).where(eq(quotes.providerOrgId, ctx.org.id)).orderBy(desc(quotes.createdAt)).limit(100);
}
