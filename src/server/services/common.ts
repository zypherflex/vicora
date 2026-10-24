import { and, eq, sql } from "drizzle-orm";
import type { Ctx } from "@/server/authz/context";
import type { Executor } from "@/server/db/client";
import { auditLog, jobs, shipmentEvents, shipmentParties, shipments } from "@/server/db/schema";
import { notFound } from "@/server/http/errors";
import type { PartyRole } from "@/lib/domain";

export async function audit(
  ctx: Ctx,
  action: string,
  entityType: string,
  entityId: string | null,
  change: { before?: unknown; after?: unknown } = {},
) {
  await ctx.db.insert(auditLog).values({
    orgId: ctx.org.id,
    actorUserId: ctx.user.id,
    action,
    entityType,
    entityId,
    before: change.before ?? null,
    after: change.after ?? null,
    ip: ctx.ip,
    requestId: ctx.requestId,
  });
}

export interface EventInput {
  type: string;
  title: string;
  detail?: Record<string, unknown>;
  legId?: string | null;
  /** Restrict the event to the acting organization (internal). Default: visible to all parties. */
  internal?: boolean;
  /** Show on the public customer tracking page. */
  customerTracking?: boolean;
  occurredAt?: Date;
}

export async function recordEvent(ctx: Ctx, shipmentId: string, e: EventInput) {
  const [row] = await ctx.db
    .insert(shipmentEvents)
    .values({
      shipmentId,
      legId: e.legId ?? null,
      type: e.type,
      title: e.title,
      detail: e.detail ?? {},
      actorUserId: ctx.user.id,
      actorOrgId: ctx.org.id,
      visibleToOrgId: e.internal ? ctx.org.id : null,
      customerTracking: e.customerTracking ?? false,
      occurredAt: e.occurredAt ?? new Date(),
    })
    .returning({ id: shipmentEvents.id });
  if (!e.internal) {
    await enqueue(ctx.db, "notify.shipment_event", { eventId: row.id, shipmentId, actorUserId: ctx.user.id });
  }
  return row.id;
}

export async function enqueue(
  db: Executor,
  type: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
) {
  await db
    .insert(jobs)
    .values({ type, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey, maxAttempts: opts.maxAttempts ?? 5 })
    .onConflictDoNothing();
}

export async function nextCounter(db: Executor, key: string): Promise<number> {
  const rows = await db.execute<{ value: string }>(sql`
    insert into counters (key, value) values (${key}, 1)
    on conflict (key) do update set value = counters.value + 1
    returning value`);
  return Number(rows[0].value);
}

export interface ShipmentAccess {
  shipment: typeof shipments.$inferSelect;
  roles: PartyRole[];
  isCustomer: boolean;
  isProvider: boolean;
  isExecutor: boolean;
  isCustomsBroker: boolean;
  /** Visible only as an open request or tender preview, not as a party. */
  previewOnly: boolean;
}

/**
 * Load a shipment the current org can see (RLS enforces visibility; this adds role resolution).
 * Throws NOT_FOUND rather than FORBIDDEN so existence is not leaked across tenants.
 */
export async function loadShipmentAccess(ctx: Ctx, shipmentId: string): Promise<ShipmentAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(shipmentId)) throw notFound("Shipment");
  const [shipment] = await ctx.db.select().from(shipments).where(eq(shipments.id, shipmentId)).limit(1);
  if (!shipment) throw notFound("Shipment");
  const parties = await ctx.db
    .select({ role: shipmentParties.role })
    .from(shipmentParties)
    .where(and(eq(shipmentParties.shipmentId, shipmentId), eq(shipmentParties.orgId, ctx.org.id)));
  const roles = parties.map((p) => p.role);
  const isCustomer = shipment.ownerOrgId === ctx.org.id;
  if (isCustomer && !roles.includes("CUSTOMER")) roles.push("CUSTOMER");
  return {
    shipment,
    roles,
    isCustomer,
    isProvider: roles.includes("PRIMARY_PROVIDER"),
    isExecutor: roles.includes("CARRIER"),
    isCustomsBroker: roles.includes("CUSTOMS_BROKER"),
    previewOnly: roles.length === 0,
  };
}

export async function requireParty(ctx: Ctx, shipmentId: string): Promise<ShipmentAccess> {
  const a = await loadShipmentAccess(ctx, shipmentId);
  if (a.previewOnly) throw notFound("Shipment");
  return a;
}
