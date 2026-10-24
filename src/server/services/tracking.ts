import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { randomToken, sha256Hex } from "@/server/auth/crypto";
import { requirePerm, type Ctx } from "@/server/authz/context";
import { systemDb } from "@/server/db/client";
import { locationPings, organizations, shipmentEvents, shipmentLegs, shipments, shipmentStops, trackingLinks, vehicles } from "@/server/db/schema";
import { notFound } from "@/server/http/errors";
import type { trackingLinkSchema } from "@/server/validators";
import { audit, recordEvent, requireParty } from "./common";

export async function createTrackingLink(ctx: Ctx, shipmentId: string, input: z.infer<typeof trackingLinkSchema>) {
  requirePerm(ctx, "tracking_link.manage");
  await requireParty(ctx, shipmentId);
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
  const [link] = await ctx.db
    .insert(trackingLinks)
    .values({ shipmentId, tokenHash: sha256Hex(token), tokenPrefix: token.slice(0, 6), label: input.label, createdByUserId: ctx.user.id, createdByOrgId: ctx.org.id, expiresAt })
    .returning({ id: trackingLinks.id, expiresAt: trackingLinks.expiresAt });
  await recordEvent(ctx, shipmentId, { type: "TRACKING_LINK_CREATED", title: `Tracking link created${input.label ? ` for ${input.label}` : ""}`, internal: true });
  await audit(ctx, "tracking_link.created", "tracking_link", link.id);
  // The raw token is shown once; only its hash is stored.
  return { ...link, token, path: `/t/${token}` };
}

export async function revokeTrackingLink(ctx: Ctx, linkId: string) {
  requirePerm(ctx, "tracking_link.manage");
  const [link] = await ctx.db.select().from(trackingLinks).where(eq(trackingLinks.id, linkId));
  if (!link) throw notFound("Tracking link");
  await ctx.db.update(trackingLinks).set({ revokedAt: new Date() }).where(eq(trackingLinks.id, linkId));
  await audit(ctx, "tracking_link.revoked", "tracking_link", linkId);
}

/**
 * Public tracking projection. Uses the system connection, but only after the token hash matches an
 * unexpired, unrevoked link, and only returns fields approved for customers:
 * milestones flagged for tracking, city-level location, ETA. No documents, notes, parties' rates or contacts.
 */
export async function publicTracking(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const db = systemDb();
  const [link] = await db
    .select()
    .from(trackingLinks)
    .where(and(eq(trackingLinks.tokenHash, sha256Hex(token)), isNull(trackingLinks.revokedAt)));
  if (!link || link.expiresAt < new Date()) return null;
  await db.update(trackingLinks).set({ lastAccessedAt: new Date() }).where(eq(trackingLinks.id, link.id));

  const [s] = await db.select().from(shipments).where(eq(shipments.id, link.shipmentId));
  if (!s) return null;
  const [stops, events, legs, ping, vehicleRows, provider] = await Promise.all([
    db.select().from(shipmentStops).where(eq(shipmentStops.shipmentId, s.id)).orderBy(asc(shipmentStops.seq)),
    db
      .select({ title: shipmentEvents.title, occurredAt: shipmentEvents.occurredAt, type: shipmentEvents.type })
      .from(shipmentEvents)
      .where(and(eq(shipmentEvents.shipmentId, s.id), eq(shipmentEvents.customerTracking, true), isNull(shipmentEvents.visibleToOrgId)))
      .orderBy(desc(shipmentEvents.occurredAt))
      .limit(50),
    db.select().from(shipmentLegs).where(eq(shipmentLegs.shipmentId, s.id)).orderBy(asc(shipmentLegs.seq)),
    db.select().from(locationPings).where(eq(locationPings.shipmentId, s.id)).orderBy(desc(locationPings.recordedAt)).limit(1),
    db.select({ year: vehicles.year, make: vehicles.make, model: vehicles.model, status: vehicles.status, vin: vehicles.vin }).from(vehicles).where(eq(vehicles.shipmentId, s.id)),
    s.primaryProviderOrgId ? db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, s.primaryProviderOrgId)) : Promise.resolve([]),
  ]);
  const active = legs.find((l) => !["DELIVERED", "CANCELLED"].includes(l.status)) ?? legs[legs.length - 1];
  const p = ping[0];
  return {
    reference: s.reference,
    title: s.title,
    status: s.status,
    serviceType: s.serviceType,
    isDemo: s.isDemo,
    provider: provider[0]?.name ?? null,
    origin: stops[0] ? { city: stops[0].city, state: stops[0].state, windowStart: stops[0].windowStart, timezone: stops[0].timezone } : null,
    destination: stops.at(-1) ? { city: stops.at(-1)!.city, state: stops.at(-1)!.state, windowEnd: stops.at(-1)!.windowEnd, timezone: stops.at(-1)!.timezone } : null,
    stops: stops.map((x) => ({ city: x.city, state: x.state, kind: x.kind })),
    etaAt: active?.etaAt ?? active?.plannedDeliveryAt ?? null,
    deliveredAt: legs.at(-1)?.actualDeliveryAt ?? null,
    // City-level precision only: round coordinates to ~10 km.
    lastLocation: p ? { lat: Math.round(p.lat * 10) / 10, lng: Math.round(p.lng * 10) / 10, label: p.label, source: p.source, recordedAt: p.recordedAt } : null,
    milestones: events,
    vehicles: vehicleRows.map((v) => ({ description: `${v.year} ${v.make} ${v.model}`, vinLast6: v.vin.slice(-6), status: v.status })),
    expiresAt: link.expiresAt,
  };
}
