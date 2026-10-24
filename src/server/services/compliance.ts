import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { EQUIPMENT_LABEL, type EquipmentType } from "@/lib/domain";
import { requirePerm, type Ctx } from "@/server/authz/context";
import type { DB } from "@/server/db/client";
import { complianceRecords, documents, organizations, providerProfiles, shipmentLegs, shipments, shipmentStops } from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type { complianceRecordSchema, verifyComplianceSchema } from "@/server/validators";
import { audit, enqueue, requireParty } from "./common";

export const COMPLIANCE_LABEL: Record<string, string> = {
  OPERATING_AUTHORITY: "Operating authority (MC)",
  USDOT_REGISTRATION: "USDOT registration",
  AUTO_LIABILITY_INSURANCE: "Auto liability insurance",
  CARGO_INSURANCE: "Cargo insurance",
  CUSTOMS_LICENSE: "Customs broker license",
  W9: "Form W-9",
};

export const SOURCE_LABEL: Record<string, string> = {
  SELF_REPORTED: "Self-reported by the provider (not verified)",
  MANUAL_DOCUMENT_REVIEW: "Manual review of uploaded document",
  DEMO_ADAPTER: "Demonstration adapter (no external check performed)",
  FMCSA_API: "FMCSA (external)",
};

/** External verification integrations. None are connected; the UI shows this state explicitly. */
export const VERIFICATION_INTEGRATIONS = [
  { key: "FMCSA_QCMOBILE", name: "FMCSA QCMobile API", status: "NOT_CONNECTED", requires: "An FMCSA web key (free registration) and an adapter implementing lookups by USDOT/MC number." },
  { key: "INSURANCE_MONITORING", name: "Insurance certificate monitoring", status: "NOT_CONNECTED", requires: "A contract with a certificate-monitoring provider and its API credentials." },
] as const;

export async function addComplianceRecord(ctx: Ctx, input: z.infer<typeof complianceRecordSchema>) {
  requirePerm(ctx, "compliance.manage");
  if (input.documentId) {
    const [d] = await ctx.db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, input.documentId), eq(documents.ownerOrgId, ctx.org.id)));
    if (!d) throw notFound("Document");
  }
  const [row] = await ctx.db
    .insert(complianceRecords)
    .values({ subjectOrgId: ctx.org.id, ...input, documentId: input.documentId ?? null, status: input.documentId ? "PENDING_REVIEW" : "UNVERIFIED", source: "SELF_REPORTED" })
    .returning();
  await audit(ctx, "compliance.record_added", "compliance_record", row.id, { after: { type: input.type } });
  return row;
}

export async function listComplianceFor(ctx: Ctx, orgId: string) {
  requirePerm(ctx, "compliance.read");
  return ctx.db.select().from(complianceRecords).where(eq(complianceRecords.subjectOrgId, orgId)).orderBy(desc(complianceRecords.createdAt));
}

/**
 * Record a verification decision. MANUAL_DOCUMENT_REVIEW requires an attached document.
 * DEMO_ADAPTER is allowed only for demonstration organizations and is labeled as such everywhere.
 */
export async function verifyComplianceRecord(ctx: Ctx, recordId: string, input: z.infer<typeof verifyComplianceSchema>) {
  requirePerm(ctx, "compliance.verify");
  const [rec] = await ctx.db.select().from(complianceRecords).where(eq(complianceRecords.id, recordId));
  if (!rec) throw notFound("Compliance record");
  if (rec.subjectOrgId === ctx.org.id) throw new AppError("FORBIDDEN", "Organizations cannot verify their own records");
  if (input.method === "MANUAL_DOCUMENT_REVIEW" && !rec.documentId) throw conflict("Manual review requires the provider to attach the supporting document");
  if (input.method === "DEMO_ADAPTER") {
    const [subject] = await ctx.db.select({ isDemo: organizations.isDemo }).from(organizations).where(eq(organizations.id, rec.subjectOrgId));
    if (!subject?.isDemo) throw conflict("The demonstration adapter can only be used with demonstration organizations");
  }
  if (input.result === "VERIFIED" && rec.expiresAt && rec.expiresAt < new Date()) throw conflict("This record has expired and cannot be verified");
  await ctx.db
    .update(complianceRecords)
    .set({ status: input.result, source: input.method, verifiedAt: new Date(), verifiedByUserId: ctx.user.id, verifiedByOrgId: ctx.org.id, notes: input.notes ?? rec.notes })
    .where(eq(complianceRecords.id, rec.id));
  await audit(ctx, "compliance.verified", "compliance_record", rec.id, { before: { status: rec.status }, after: { status: input.result, method: input.method } });
}

/** Daily job: expire lapsed records and remind subjects 30/7 days ahead. */
export async function processComplianceExpirations(db: DB, now = new Date()) {
  const expired = await db
    .update(complianceRecords)
    .set({ status: "EXPIRED" })
    .where(and(lt(complianceRecords.expiresAt, now), inArray(complianceRecords.status, ["UNVERIFIED", "PENDING_REVIEW", "VERIFIED"])))
    .returning();
  const soon = await db.execute<{ id: string; subject_org_id: string; type: string; expires_at: Date; days: number }>(sql`
    select id, subject_org_id, type, expires_at, ceil(extract(epoch from (expires_at - ${now})) / 86400)::int as days
    from compliance_records where status in ('VERIFIED','PENDING_REVIEW','UNVERIFIED')
      and expires_at between ${now} and ${now}::timestamptz + interval '30 days'`);
  for (const r of soon) {
    if (r.days !== 30 && r.days !== 7) continue;
    await enqueue(db, "notify.org", {
      orgId: r.subject_org_id,
      type: "COMPLIANCE_EXPIRING",
      title: `${COMPLIANCE_LABEL[r.type] ?? r.type} expires in ${r.days} days`,
      link: "/compliance",
    }, { dedupeKey: `compliance-expiring:${r.id}:${r.days}` });
  }
  for (const r of expired) {
    await enqueue(db, "notify.org", { orgId: r.subjectOrgId, type: "COMPLIANCE_EXPIRED", title: `${COMPLIANCE_LABEL[r.type] ?? r.type} has expired`, link: "/compliance" }, { dedupeKey: `compliance-expired:${r.id}` });
  }
  return { expired: expired.length };
}

/* ---------------------------------------------------------------- Provider matching */

export interface MatchCriterion {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}
export interface ProviderMatch {
  orgId: string;
  name: string;
  type: string;
  eligible: boolean;
  ineligibleReasons: string[];
  score: number;
  criteria: MatchCriterion[];
  verification: { authority: string; insurance: string; lastVerifiedAt: Date | null; source: string | null };
}

interface MatchInput {
  serviceType: string;
  equipmentType: string | null;
  originState: string;
  destinationState: string;
  providers: {
    orgId: string;
    name: string;
    type: string;
    profile: { serviceTypes: string[]; equipmentTypes: string[]; serviceStates: string[]; acceptingLoads: boolean; onTimePct: number | null; completedLoads: number } | null;
    available: { type: string; available: number }[];
    records: { type: string; status: string; expiresAt: Date | null; verifiedAt: Date | null; source: string }[];
  }[];
  now?: Date;
}

/**
 * Transparent, rule-based ranking. Eligibility gates first (service type, equipment, accepting loads);
 * then points for service area, equipment availability, verified records and on-time history.
 * Unverified records never earn verification points and are shown as "Not verified".
 */
export function rankProviders(input: MatchInput): ProviderMatch[] {
  const now = input.now ?? new Date();
  const out = input.providers.map((p): ProviderMatch => {
    const reasons: string[] = [];
    const prof = p.profile;
    if (!prof) reasons.push("No provider profile");
    if (prof && !prof.acceptingLoads) reasons.push("Not accepting loads");
    if (prof && !prof.serviceTypes.includes(input.serviceType)) reasons.push(`Does not offer ${input.serviceType}`);
    if (prof && input.equipmentType && !prof.equipmentTypes.includes(input.equipmentType))
      reasons.push(`No ${EQUIPMENT_LABEL[input.equipmentType as EquipmentType] ?? input.equipmentType}`);

    const criteria: MatchCriterion[] = [];
    const states = prof?.serviceStates ?? [];
    const area = (states.includes(input.originState) ? 1 : 0) + (states.includes(input.destinationState) ? 1 : 0);
    criteria.push({ key: "service_area", label: "Service area", points: area * 12.5, max: 25, detail: `${area}/2 of origin (${input.originState}) and destination (${input.destinationState}) states served` });

    const avail = input.equipmentType ? (p.available.find((a) => a.type === input.equipmentType)?.available ?? 0) : p.available.reduce((s, a) => s + a.available, 0);
    criteria.push({ key: "availability", label: "Equipment availability", points: Math.min(avail, 3) * (25 / 3), max: 25, detail: `${avail} matching unit${avail === 1 ? "" : "s"} available within 3 days` });

    const valid = (t: string) => p.records.find((r) => r.type === t && r.status === "VERIFIED" && (!r.expiresAt || r.expiresAt > now));
    const authority = valid("OPERATING_AUTHORITY");
    const insurance = valid("AUTO_LIABILITY_INSURANCE") ?? valid("CARGO_INSURANCE");
    criteria.push({
      key: "verification",
      label: "Verified records",
      points: (authority ? 15 : 0) + (insurance ? 15 : 0),
      max: 30,
      detail: `Authority: ${authority ? "verified" : "not verified"}; insurance: ${insurance ? "verified" : "not verified"}`,
    });

    const otp = prof?.onTimePct;
    criteria.push({
      key: "performance",
      label: "On-time history",
      points: otp == null || (prof?.completedLoads ?? 0) < 5 ? 0 : Math.max(0, (otp - 80) / 20) * 20,
      max: 20,
      detail: otp == null || (prof?.completedLoads ?? 0) < 5 ? "Insufficient history (fewer than 5 loads)" : `${otp}% on time across ${prof?.completedLoads} loads`,
    });

    const lastVerified = p.records.filter((r) => r.verifiedAt).sort((a, b) => +b.verifiedAt! - +a.verifiedAt!)[0];
    const status = (t: string[]) => {
      const r = p.records.find((x) => t.includes(x.type));
      if (!r) return "No record";
      if (r.expiresAt && r.expiresAt < now) return "Expired";
      return r.status === "VERIFIED" ? "Verified" : "Not verified";
    };
    return {
      orgId: p.orgId,
      name: p.name,
      type: p.type,
      eligible: reasons.length === 0,
      ineligibleReasons: reasons,
      score: Math.round(criteria.reduce((s, c) => s + c.points, 0)),
      criteria,
      verification: {
        authority: status(["OPERATING_AUTHORITY"]),
        insurance: status(["AUTO_LIABILITY_INSURANCE", "CARGO_INSURANCE"]),
        lastVerifiedAt: lastVerified?.verifiedAt ?? null,
        source: lastVerified?.source ?? null,
      },
    };
  });
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.name.localeCompare(b.name));
}

export async function matchProviders(ctx: Ctx, shipmentId: string, purpose: "tender" | "invite") {
  requirePerm(ctx, "shipment.read");
  const access = await requireParty(ctx, shipmentId);
  const s = access.shipment;
  const stops = await ctx.db.select().from(shipmentStops).where(eq(shipmentStops.shipmentId, s.id));
  const sorted = stops.sort((a, b) => a.seq - b.seq);
  const types = purpose === "tender" ? (["CARRIER", "AUTO_TRANSPORT"] as const) : (["FREIGHT_BROKER", "CARRIER", "AUTO_TRANSPORT"] as const);
  const orgs = await ctx.db
    .select({ id: organizations.id, name: organizations.name, type: organizations.type })
    .from(organizations)
    .where(and(inArray(organizations.type, [...types]), eq(organizations.status, "ACTIVE")));
  const candidates = orgs.filter((o) => o.id !== ctx.org.id);
  if (!candidates.length) return [];
  const ids = candidates.map((o) => o.id);
  const [profiles, avail, records] = await Promise.all([
    ctx.db.select().from(providerProfiles).where(inArray(providerProfiles.orgId, ids)),
    ctx.db.execute<{ org_id: string; type: string; available: number }>(sql`select * from app_equipment_availability()`),
    ctx.db.select().from(complianceRecords).where(inArray(complianceRecords.subjectOrgId, ids)),
  ]);
  // Brokers source carriers for the leg's actual service, which for a broker-booked shipment is the shipment's service.
  return rankProviders({
    serviceType: s.serviceType,
    equipmentType: s.equipmentType,
    originState: sorted[0]?.state ?? "",
    destinationState: sorted.at(-1)?.state ?? "",
    providers: candidates.map((o) => ({
      orgId: o.id,
      name: o.name,
      type: o.type,
      profile: profiles.find((p) => p.orgId === o.id) ?? null,
      available: avail.filter((a) => a.org_id === o.id).map((a) => ({ type: a.type, available: a.available })),
      records: records.filter((r) => r.subjectOrgId === o.id),
    })),
  });
}

export async function providerDirectory(ctx: Ctx) {
  requirePerm(ctx, "compliance.read");
  const orgs = await ctx.db
    .select({ id: organizations.id, name: organizations.name, type: organizations.type, city: organizations.city, state: organizations.state, usdot: organizations.usdotNumber, mc: organizations.mcNumber, isDemo: organizations.isDemo })
    .from(organizations)
    .where(inArray(organizations.type, ["CARRIER", "AUTO_TRANSPORT", "FREIGHT_BROKER"]));
  const ids = orgs.map((o) => o.id);
  const [profiles, records, legs] = await Promise.all([
    ids.length ? ctx.db.select().from(providerProfiles).where(inArray(providerProfiles.orgId, ids)) : [],
    ids.length ? ctx.db.select().from(complianceRecords).where(inArray(complianceRecords.subjectOrgId, ids)) : [],
    ctx.db.select({ executor: shipmentLegs.executorOrgId }).from(shipmentLegs).innerJoin(shipments, eq(shipments.id, shipmentLegs.shipmentId)),
  ]);
  return orgs.map((o) => ({ ...o, profile: profiles.find((p) => p.orgId === o.id) ?? null, records: records.filter((r) => r.subjectOrgId === o.id), sharedLoads: legs.filter((l) => l.executor === o.id).length }));
}
