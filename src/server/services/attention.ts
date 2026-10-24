import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { formatInTimeZone } from "@/lib/time";
import type { Ctx } from "@/server/authz/context";
import type { DB } from "@/server/db/client";
import {
  charges,
  customsEntries,
  documentRequirements,
  documents,
  locationPings,
  quotes,
  shipmentExceptions,
  shipmentLegs,
  shipments,
  shipmentStops,
  tasks,
  tenders,
} from "@/server/db/schema";

export type Severity = "critical" | "high" | "medium" | "low";
export interface AttentionItem {
  id: string;
  rule: string;
  severity: Severity;
  shipmentId: string | null;
  reference: string | null;
  title: string;
  /** Human-readable facts that triggered the item, so the reason is never a black box. */
  evidence: string[];
  action: { label: string; href: string };
  at: Date | null;
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const HOUR = 3600_000;
export const STALE_TRACKING_HOURS = 6;

/**
 * Exception-first operations: compute what needs attention for the current org right now.
 * Every rule is deterministic and returns the evidence it used.
 */
export async function attentionFor(ctx: Ctx, now = new Date()): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const tz = ctx.org.timezone;
  const fmt = (d: Date | null | undefined, z = tz) => (d ? formatInTimeZone(d, z) : "—");

  const ships = await ctx.db
    .select()
    .from(shipments)
    .where(and(sql`app_is_party(${shipments.id})`, inArray(shipments.status, ["QUOTE_REQUESTED", "BOOKED", "ASSIGNED", "DISPATCHED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"])));
  const ids = ships.map((s) => s.id);
  const ref = new Map(ships.map((s) => [s.id, s]));
  if (ids.length) {
    const [legs, stops, lastPings, reqs, exs, pods, subQuotes, customs] = await Promise.all([
      ctx.db.select().from(shipmentLegs).where(inArray(shipmentLegs.shipmentId, ids)).orderBy(asc(shipmentLegs.seq)),
      ctx.db.select().from(shipmentStops).where(inArray(shipmentStops.shipmentId, ids)),
      ctx.db
        .selectDistinctOn([locationPings.legId])
        .from(locationPings)
        .where(inArray(locationPings.shipmentId, ids))
        .orderBy(locationPings.legId, sql`${locationPings.recordedAt} desc`),
      ctx.db.select().from(documentRequirements).where(and(inArray(documentRequirements.shipmentId, ids), eq(documentRequirements.status, "REQUESTED"))),
      ctx.db.select().from(shipmentExceptions).where(and(inArray(shipmentExceptions.shipmentId, ids), inArray(shipmentExceptions.status, ["OPEN", "ACKNOWLEDGED"]))),
      ctx.db.select({ shipmentId: documents.shipmentId }).from(documents).where(and(inArray(documents.shipmentId, ids), eq(documents.category, "PROOF_OF_DELIVERY"), isNull(documents.deletedAt))),
      ctx.db.select().from(quotes).where(and(inArray(quotes.shipmentId, ids), eq(quotes.status, "SUBMITTED"))),
      ctx.db.select().from(customsEntries).where(and(inArray(customsEntries.shipmentId, ids), eq(customsEntries.brokerOrgId, ctx.org.id))),
    ]);
    const stop = (id: string | null) => stops.find((s) => s.id === id);

    for (const s of ships) {
      const isCustomer = s.ownerOrgId === ctx.org.id;
      const myLegs = legs.filter((l) => l.shipmentId === s.id);
      const operating = myLegs.filter((l) => l.executorOrgId === ctx.org.id || l.managerOrgId === ctx.org.id);

      if (isCustomer && s.status === "QUOTE_REQUESTED") {
        const qs = subQuotes.filter((q) => q.shipmentId === s.id);
        if (qs.length) {
          const soonest = qs.map((q) => q.validUntil).filter(Boolean).sort((a, b) => +a! - +b!)[0];
          items.push({
            id: `quotes:${s.id}`,
            rule: "QUOTES_AWAITING_DECISION",
            severity: soonest && +soonest - +now < 24 * HOUR ? "high" : "medium",
            shipmentId: s.id,
            reference: s.reference,
            title: `${qs.length} quote${qs.length > 1 ? "s" : ""} awaiting your decision`,
            evidence: [`Lowest total: ${(Math.min(...qs.map((q) => q.totalMinor)) / 100).toFixed(2)} ${s.currency}`, soonest ? `First quote expires ${fmt(soonest)}` : "No expiry set"],
            action: { label: "Compare quotes", href: `/shipments/${s.id}?tab=quotes` },
            at: soonest ?? null,
          });
        }
      }

      for (const l of operating) {
        const from = stop(l.fromStopId);
        const to = stop(l.toStopId);
        const notPicked = ["PLANNED", "TENDERED", "ACCEPTED", "DISPATCHED", "AT_PICKUP"].includes(l.status);
        if (notPicked && from?.windowEnd && from.windowEnd < now) {
          items.push({
            id: `late-pickup:${l.id}`,
            rule: "LATE_PICKUP",
            severity: "critical",
            shipmentId: s.id,
            reference: s.reference,
            title: `Pickup window missed at ${from.city}, ${from.state}`,
            evidence: [`Window closed ${fmt(from.windowEnd, from.timezone)}`, `Leg ${l.seq + 1} status: ${l.status.toLowerCase().replace(/_/g, " ")}`],
            action: { label: "Open shipment", href: `/shipments/${s.id}` },
            at: from.windowEnd,
          });
        } else if (["PLANNED", "TENDERED"].includes(l.status) && l.managerOrgId === ctx.org.id && from?.windowStart && +from.windowStart - +now < 48 * HOUR) {
          items.push({
            id: `uncovered:${l.id}`,
            rule: "UNCOVERED_LOAD",
            severity: +from.windowStart - +now < 12 * HOUR ? "high" : "medium",
            shipmentId: s.id,
            reference: s.reference,
            title: `No carrier confirmed for leg ${l.seq + 1}`,
            evidence: [`Pickup opens ${fmt(from.windowStart, from.timezone)}`, l.status === "TENDERED" ? "Tender outstanding" : "Not yet tendered"],
            action: { label: "Find carrier", href: `/shipments/${s.id}?tab=dispatch` },
            at: from.windowStart,
          });
        } else if (l.status === "ACCEPTED" && l.executorOrgId === ctx.org.id && from?.windowStart && +from.windowStart - +now < 24 * HOUR) {
          items.push({
            id: `undispatched:${l.id}`,
            rule: "NOT_DISPATCHED",
            severity: "high",
            shipmentId: s.id,
            reference: s.reference,
            title: `Assign a driver for pickup at ${from.city}`,
            evidence: [`Pickup opens ${fmt(from.windowStart, from.timezone)}`, "No driver or unit dispatched"],
            action: { label: "Dispatch", href: `/shipments/${s.id}?tab=dispatch` },
            at: from.windowStart,
          });
        }
        if (["PICKED_UP", "IN_TRANSIT"].includes(l.status)) {
          const ping = lastPings.find((p) => p.legId === l.id);
          const since = ping?.recordedAt ?? l.actualPickupAt;
          if (since && +now - +since > STALE_TRACKING_HOURS * HOUR) {
            items.push({
              id: `stale:${l.id}`,
              rule: "STALE_TRACKING",
              severity: "medium",
              shipmentId: s.id,
              reference: s.reference,
              title: "No location update in over 6 hours",
              evidence: [ping ? `Last update ${fmt(ping.recordedAt)} (${ping.source.toLowerCase().replace("_", " ")})` : `No location since pickup at ${fmt(l.actualPickupAt)}`],
              action: { label: "Request update", href: `/shipments/${s.id}?tab=messages` },
              at: since,
            });
          }
          if (l.etaAt && to?.windowEnd && l.etaAt > to.windowEnd) {
            items.push({
              id: `eta:${l.id}`,
              rule: "DELIVERY_AT_RISK",
              severity: "high",
              shipmentId: s.id,
              reference: s.reference,
              title: `Delivery to ${to.city} projected late`,
              evidence: [`Estimated arrival ${fmt(l.etaAt, to.timezone)} (straight-line estimate)`, `Delivery window closes ${fmt(to.windowEnd, to.timezone)}`],
              action: { label: "Notify customer", href: `/shipments/${s.id}?tab=messages` },
              at: l.etaAt,
            });
          }
        }
      }

      for (const r of reqs.filter((r) => r.shipmentId === s.id)) {
        const mine = isCustomer || r.requestedByOrgId === ctx.org.id;
        if (!mine) continue;
        const overdue = r.dueAt && r.dueAt < now;
        items.push({
          id: `doc:${r.id}`,
          rule: "MISSING_DOCUMENT",
          severity: overdue ? "high" : "medium",
          shipmentId: s.id,
          reference: s.reference,
          title: `${isCustomer ? "Upload" : "Waiting on"} ${r.category.replace(/_/g, " ").toLowerCase()}`,
          evidence: [r.dueAt ? `${overdue ? "Overdue since" : "Due"} ${fmt(r.dueAt)}` : "No due date", r.note ?? "Requested on the shipment checklist"],
          action: { label: isCustomer ? "Upload document" : "View checklist", href: `/shipments/${s.id}?tab=documents` },
          at: r.dueAt,
        });
      }

      if (s.status === "DELIVERED" && (s.primaryProviderOrgId === ctx.org.id || operating.length) && !pods.some((p) => p.shipmentId === s.id)) {
        items.push({
          id: `pod:${s.id}`,
          rule: "MISSING_POD",
          severity: "medium",
          shipmentId: s.id,
          reference: s.reference,
          title: "Delivered without a proof-of-delivery document",
          evidence: ["Carrier payables stay on hold until POD is received"],
          action: { label: "Upload POD", href: `/shipments/${s.id}?tab=documents` },
          at: null,
        });
      }

      for (const e of exs.filter((x) => x.shipmentId === s.id)) {
        items.push({
          id: `ex:${e.id}`,
          rule: `EXCEPTION_${e.type}`,
          severity: e.severity === "CRITICAL" ? "critical" : e.severity === "HIGH" ? "high" : e.severity === "MEDIUM" ? "medium" : "low",
          shipmentId: s.id,
          reference: s.reference,
          title: e.title,
          evidence: [e.description ?? "", `Opened ${fmt(e.createdAt)} by ${e.detectedBy === "USER" ? "a team member" : "an automated rule"}`, e.status === "ACKNOWLEDGED" ? "Acknowledged, not resolved" : "Not yet acknowledged"].filter(Boolean),
          action: { label: "Resolve", href: `/shipments/${s.id}?tab=exceptions` },
          at: e.createdAt,
        });
      }

      for (const c of customs.filter((x) => x.shipmentId === s.id)) {
        if (c.arrivalAt && ["INTAKE", "DOCS_PENDING", "IN_REVIEW"].includes(c.status) && +c.arrivalAt - +now < 72 * HOUR) {
          items.push({
            id: `customs:${c.id}`,
            rule: "CUSTOMS_ARRIVAL_SOON",
            severity: +c.arrivalAt - +now < 24 * HOUR ? "critical" : "high",
            shipmentId: s.id,
            reference: s.reference,
            title: `Arrival ${+c.arrivalAt < +now ? "passed" : "approaching"}; customs file not ready`,
            evidence: [`Arrival ${fmt(c.arrivalAt)}`, `File status: ${c.status.toLowerCase().replace(/_/g, " ")}`],
            action: { label: "Open customs file", href: `/customs/${c.id}` },
            at: c.arrivalAt,
          });
        }
      }
    }
  }

  // Organization-level items.
  const [myTenders, overdueTasks, pendingCharges] = await Promise.all([
    ctx.db.select().from(tenders).where(and(eq(tenders.status, "OFFERED"), eq(tenders.toOrgId, ctx.org.id))),
    ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), eq(tasks.status, "OPEN"), lt(tasks.dueAt, new Date(+now + 24 * HOUR)))),
    ctx.db.select().from(charges).where(and(eq(charges.billToOrgId, ctx.org.id), eq(charges.status, "ESTIMATED"))),
  ]);
  for (const t of myTenders) {
    items.push({
      id: `tender:${t.id}`,
      rule: "TENDER_AWAITING_RESPONSE",
      severity: t.expiresAt && +t.expiresAt - +now < 4 * HOUR ? "high" : "medium",
      shipmentId: t.shipmentId,
      reference: ref.get(t.shipmentId)?.reference ?? null,
      title: "Load tender awaiting your response",
      evidence: [`Rate ${(t.rateMinor / 100).toFixed(2)} ${t.currency}`, t.expiresAt ? `Expires ${fmt(t.expiresAt)}` : "No expiry"],
      action: { label: "Respond", href: `/tenders` },
      at: t.expiresAt,
    });
  }
  for (const t of overdueTasks) {
    const overdue = t.dueAt && t.dueAt < now;
    items.push({
      id: `task:${t.id}`,
      rule: overdue ? "TASK_OVERDUE" : "TASK_DUE_SOON",
      severity: overdue ? "high" : "low",
      shipmentId: t.shipmentId,
      reference: t.shipmentId ? ref.get(t.shipmentId)?.reference ?? null : null,
      title: t.title,
      evidence: [`${overdue ? "Was due" : "Due"} ${fmt(t.dueAt)}`],
      action: { label: "Open", href: t.customsEntryId ? `/customs/${t.customsEntryId}` : t.shipmentId ? `/shipments/${t.shipmentId}` : "/" },
      at: t.dueAt,
    });
  }
  for (const c of pendingCharges) {
    items.push({
      id: `charge:${c.id}`,
      rule: "CHARGE_APPROVAL",
      severity: "low",
      shipmentId: c.shipmentId,
      reference: ref.get(c.shipmentId)?.reference ?? null,
      title: `Approve or dispute charge: ${c.description}`,
      evidence: [`${(c.amountMinor / 100).toFixed(2)} ${c.currency} (estimated, not yet confirmed)`],
      action: { label: "Review", href: `/shipments/${c.shipmentId}?tab=finance` },
      at: c.createdAt,
    });
  }

  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || +(a.at ?? now) - +(b.at ?? now));
}

/**
 * Background rule (system context): persist stale-tracking and missed-pickup findings as exceptions
 * so every party sees them on the timeline. Deduplicated per leg and type while open.
 */
export async function persistRuleExceptions(db: DB, now = new Date()) {
  const rows = await db.execute<{ leg_id: string; shipment_id: string; status: string; last_at: Date | null; window_end: Date | null; actual_pickup_at: Date | null }>(sql`
    select l.id as leg_id, l.shipment_id, l.status, l.actual_pickup_at,
      (select max(p.recorded_at) from location_pings p where p.leg_id = l.id) as last_at,
      fs.window_end
    from shipment_legs l left join shipment_stops fs on fs.id = l.from_stop_id
    join shipments s on s.id = l.shipment_id
    where s.status not in ('CANCELLED','COMPLETED','DELIVERED')`);
  let created = 0;
  for (const r of rows) {
    let type: "STALE_TRACKING" | "DELAY" | null = null;
    let evidence: Record<string, unknown> = {};
    const since = r.last_at ?? r.actual_pickup_at;
    if (["PICKED_UP", "IN_TRANSIT"].includes(r.status) && since && +now - +new Date(since) > STALE_TRACKING_HOURS * HOUR) {
      type = "STALE_TRACKING";
      evidence = { rule: "stale_tracking_6h", lastLocationAt: since, hours: Math.round((+now - +new Date(since)) / HOUR) };
    } else if (["PLANNED", "TENDERED", "ACCEPTED", "DISPATCHED", "AT_PICKUP"].includes(r.status) && r.window_end && new Date(r.window_end) < now) {
      type = "DELAY";
      evidence = { rule: "pickup_window_missed", windowEnd: r.window_end, legStatus: r.status };
    }
    if (!type) continue;
    const open = await db
      .select({ id: shipmentExceptions.id })
      .from(shipmentExceptions)
      .where(and(eq(shipmentExceptions.legId, r.leg_id), eq(shipmentExceptions.type, type), inArray(shipmentExceptions.status, ["OPEN", "ACKNOWLEDGED"])));
    if (open.length) continue;
    await db.insert(shipmentExceptions).values({
      shipmentId: r.shipment_id,
      legId: r.leg_id,
      type,
      severity: type === "DELAY" ? "HIGH" : "MEDIUM",
      title: type === "DELAY" ? "Pickup window missed" : "Tracking updates stopped",
      description: type === "DELAY" ? "The pickup window closed before pickup was confirmed." : `No location update for ${evidence.hours} hours while in transit.`,
      evidence,
      detectedBy: "RULE",
    });
    created++;
  }
  return created;
}
