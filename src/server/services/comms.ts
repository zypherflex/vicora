import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { requirePerm, type Ctx } from "@/server/authz/context";
import type { DB } from "@/server/db/client";
import {
  auditLog,
  drivers,
  memberships,
  messages,
  notificationPreferences,
  notifications,
  outboundMessages,
  savedViews,
  shipmentEvents,
  shipmentLegs,
  shipmentParties,
  shipments,
  users,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { effectivePermissions } from "@/lib/permissions";
import { notFound } from "@/server/http/errors";
import type { messageSchema, notificationPrefSchema, savedViewSchema } from "@/server/validators";
import { audit, recordEvent, requireParty } from "./common";

/* ---------------------------------------------------------------- Shipment messages & internal notes */

export async function postMessage(ctx: Ctx, shipmentId: string, input: z.infer<typeof messageSchema>) {
  requirePerm(ctx, "message.write");
  if (input.visibility === "INTERNAL") requirePerm(ctx, "internal_note.write");
  await requireParty(ctx, shipmentId);
  const [m] = await ctx.db
    .insert(messages)
    .values({ shipmentId, orgId: ctx.org.id, authorUserId: ctx.user.id, visibility: input.visibility, body: input.body, aiDrafted: input.aiDrafted })
    .returning();
  await recordEvent(ctx, shipmentId, {
    type: input.visibility === "INTERNAL" ? "INTERNAL_NOTE" : "MESSAGE",
    title: input.visibility === "INTERNAL" ? `Internal note by ${ctx.user.name}` : `Message from ${ctx.user.name} (${ctx.org.name})`,
    detail: { messageId: m.id, preview: input.body.slice(0, 140) },
    internal: input.visibility === "INTERNAL",
  });
  return m;
}

/* ---------------------------------------------------------------- Notifications */

/** Event types that produce notifications. Everything else stays on the timeline only. */
export const NOTIFY_EVENT_TYPES = [
  "QUOTE_SUBMITTED",
  "QUOTE_ACCEPTED",
  "TENDER_OFFERED",
  "TENDER_ACCEPTED",
  "TENDER_DECLINED",
  "DISPATCHED",
  "STATUS_CHANGED",
  "MILESTONE",
  "EXCEPTION_OPENED",
  "DOCUMENT_REQUESTED",
  "DOCUMENT_UPLOADED",
  "MESSAGE",
  "INVOICE_ISSUED",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "CHARGE_PENDING",
  "CUSTOMS_INTAKE",
  "CUSTOMS_STATUS",
  "COMPLIANCE_EXPIRING",
  "COMPLIANCE_EXPIRED",
  "TASK_ASSIGNED",
  "PAYABLE_PAID",
] as const;

export async function listNotifications(ctx: Ctx, limit = 30) {
  return ctx.db.select().from(notifications).where(eq(notifications.userId, ctx.user.id)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markNotificationsRead(ctx: Ctx, ids: string[] | "all") {
  const where = ids === "all" ? and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)) : and(eq(notifications.userId, ctx.user.id), inArray(notifications.id, ids));
  await ctx.db.update(notifications).set({ readAt: new Date() }).where(where);
}

export async function getPreferences(ctx: Ctx) {
  const rows = await ctx.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, ctx.user.id));
  return NOTIFY_EVENT_TYPES.map((t) => rows.find((r) => r.eventType === t) ?? { userId: ctx.user.id, eventType: t, inApp: true, email: false });
}

export async function savePreferences(ctx: Ctx, input: z.infer<typeof notificationPrefSchema>) {
  for (const p of input.preferences) {
    if (!(NOTIFY_EVENT_TYPES as readonly string[]).includes(p.eventType)) continue;
    await ctx.db
      .insert(notificationPreferences)
      .values({ userId: ctx.user.id, eventType: p.eventType, inApp: p.inApp, email: p.email })
      .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.eventType], set: { inApp: p.inApp, email: p.email } });
  }
}

interface NotifyInput {
  orgId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  shipmentId?: string | null;
  excludeUserId?: string | null;
  /** Only members holding this permission are notified. */
  permission?: string;
}

/** System-context fan-out to an organization's members, honoring per-user preferences. */
export async function notifyOrg(db: DB, n: NotifyInput) {
  const members = await db
    .select({ userId: memberships.userId, roles: memberships.roles, grants: memberships.grants, revocations: memberships.revocations, email: users.email, orgType: sql<string>`(select type from organizations where id = ${n.orgId})` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, n.orgId), eq(memberships.status, "ACTIVE"), isNull(users.disabledAt)));
  // Drivers only hear about shipments they are assigned to.
  let assignedDriverUsers = new Set<string>();
  if (n.shipmentId) {
    const ds = await db
      .select({ userId: drivers.userId })
      .from(shipmentLegs)
      .innerJoin(drivers, eq(drivers.id, shipmentLegs.driverId))
      .where(eq(shipmentLegs.shipmentId, n.shipmentId));
    assignedDriverUsers = new Set(ds.map((d) => d.userId).filter(Boolean) as string[]);
  }
  const recipients = members.filter((m) => {
    if (m.userId === n.excludeUserId) return false;
    const perms = effectivePermissions(m.orgType as never, m.roles, m.grants, m.revocations);
    if (n.permission && !perms.has(n.permission as never)) return false;
    const driverOnly = m.roles.every((r) => r === "DRIVER");
    if (driverOnly && (!n.shipmentId || !assignedDriverUsers.has(m.userId))) return false;
    return true;
  });
  if (!recipients.length) return 0;
  const prefs = await db
    .select()
    .from(notificationPreferences)
    .where(and(inArray(notificationPreferences.userId, recipients.map((r) => r.userId)), eq(notificationPreferences.eventType, n.type)));
  let sent = 0;
  for (const r of recipients) {
    const p = prefs.find((x) => x.userId === r.userId) ?? { inApp: true, email: false };
    if (p.inApp) {
      await db.insert(notifications).values({ userId: r.userId, orgId: n.orgId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, shipmentId: n.shipmentId ?? null });
      sent++;
    }
    if (p.email) {
      await db.insert(outboundMessages).values({
        channel: "EMAIL",
        to: r.email,
        subject: n.title,
        body: `${n.body ?? ""}\n\n${n.link ? env().APP_URL + n.link : ""}`.trim(),
        provider: env().EMAIL_PROVIDER,
        status: env().EMAIL_PROVIDER === "outbox" ? "DELIVERED_TO_OUTBOX" : "NOT_CONNECTED",
      });
    }
  }
  return sent;
}

/** Job: notify all parties of a shared shipment event except the actor. */
export async function notifyShipmentEvent(db: DB, eventId: string) {
  const [e] = await db.select().from(shipmentEvents).where(eq(shipmentEvents.id, eventId));
  if (!e || e.visibleToOrgId) return 0;
  if (!(NOTIFY_EVENT_TYPES as readonly string[]).includes(e.type)) return 0;
  if (e.type === "STATUS_CHANGED" && !["DELIVERED", "CANCELLED", "BOOKED"].includes(String(e.detail.to))) return 0;
  if (e.type === "DOCUMENT_UPLOADED" || e.type === "MILESTONE") {
    // Only high-signal milestones notify.
    if (e.type === "MILESTONE" && !["PICKED_UP", "DELIVERED"].includes(String(e.detail.status))) return 0;
  }
  const [s] = await db.select({ reference: shipments.reference, ownerOrgId: shipments.ownerOrgId }).from(shipments).where(eq(shipments.id, e.shipmentId));
  const parties = await db.select({ orgId: shipmentParties.orgId }).from(shipmentParties).where(eq(shipmentParties.shipmentId, e.shipmentId));
  const orgIds = [...new Set([s.ownerOrgId, ...parties.map((p) => p.orgId)])];
  let n = 0;
  for (const orgId of orgIds) {
    n += await notifyOrg(db, { orgId, type: e.type, title: `${s.reference}: ${e.title}`, link: `/shipments/${e.shipmentId}`, shipmentId: e.shipmentId, excludeUserId: e.actorUserId, permission: "shipment.read" });
  }
  return n;
}

/* ---------------------------------------------------------------- Saved views */

export async function listSavedViews(ctx: Ctx) {
  return ctx.db.select().from(savedViews).where(and(eq(savedViews.userId, ctx.user.id), eq(savedViews.orgId, ctx.org.id))).orderBy(savedViews.name);
}

export async function createSavedView(ctx: Ctx, input: z.infer<typeof savedViewSchema>) {
  const [v] = await ctx.db.insert(savedViews).values({ userId: ctx.user.id, orgId: ctx.org.id, name: input.name, filters: input.filters }).returning();
  return v;
}

export async function deleteSavedView(ctx: Ctx, id: string) {
  const res = await ctx.db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, ctx.user.id))).returning({ id: savedViews.id });
  if (!res.length) throw notFound("Saved view");
}

/* ---------------------------------------------------------------- Audit trail */

export async function listAudit(ctx: Ctx, filter: { entityId?: string; limit?: number } = {}) {
  requirePerm(ctx, "audit.read");
  const where = [eq(auditLog.orgId, ctx.org.id)];
  if (filter.entityId) where.push(eq(auditLog.entityId, filter.entityId));
  const rows = await ctx.db.select().from(auditLog).where(and(...where)).orderBy(desc(auditLog.createdAt)).limit(filter.limit ?? 200);
  const ids = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean) as string[])];
  const names = ids.length ? await ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  return rows.map((r) => ({ ...r, actorName: names.find((n) => n.id === r.actorUserId)?.name ?? (r.actorUserId ? "Unknown user" : "System") }));
}

export { audit };
