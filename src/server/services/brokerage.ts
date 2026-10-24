import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { categoryLabel } from "@/lib/domain";
import { computeDueAt, DEFAULT_DEADLINE_RULES, deadlineState, estimateDutyMinor, matchPrecedents, moneyFromText, normalizeHts, readinessScore, type DeadlineAnchor } from "@/lib/customs";
import { lineAmount } from "@/lib/money";
import { answerFromPassages, reviewObservations, suggestClassification, type Passage } from "@/server/adapters/ai";
import { storage } from "@/server/adapters/storage";
import { can, requirePerm, type Ctx } from "@/server/authz/context";
import {
  charges,
  classificationItems,
  customsClients,
  customsDeadlineRules,
  customsDeadlines,
  customsEntries,
  customsLines,
  customsQuestions,
  customsReviews,
  documentExtractions,
  documentRequirements,
  documents,
  documentVersions,
  memberships,
  organizations,
  shipments,
  tasks,
  users,
  type ReviewFinding,
} from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type {
  classificationSchema,
  customsClientSchema,
  deadlineRuleSchema,
  deadlineStatusSchema,
  entryDetailsSchema,
  poaSchema,
  resolveFindingSchema,
} from "@/server/validators";
import { documentText, findDiscrepancies } from "./customs";
import { audit, enqueue, recordEvent } from "./common";

/* ================================================================ Helpers */

async function brokerEntry(ctx: Ctx, entryId: string) {
  const [e] = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.id, entryId), eq(customsEntries.brokerOrgId, ctx.org.id)));
  if (!e) throw notFound("Customs file");
  return e;
}

async function brokerClient(ctx: Ctx, clientId: string) {
  const [c] = await ctx.db.select().from(customsClients).where(and(eq(customsClients.id, clientId), eq(customsClients.brokerOrgId, ctx.org.id)));
  if (!c) throw notFound("Client");
  return c;
}

const LOCKED = ["SUBMITTED", "RELEASED", "CLOSED"];

/* ================================================================ Clients */

export async function listClients(ctx: Ctx) {
  requirePerm(ctx, "customs.read");
  const rows = await ctx.db.select().from(customsClients).where(eq(customsClients.brokerOrgId, ctx.org.id)).orderBy(asc(customsClients.name));
  const ids = rows.map((r) => r.id);
  const [items, entries] = await Promise.all([
    ids.length ? ctx.db.select({ clientId: classificationItems.clientId, status: classificationItems.status }).from(classificationItems).where(inArray(classificationItems.clientId, ids)) : [],
    ids.length ? ctx.db.select({ clientId: customsEntries.clientId, status: customsEntries.status }).from(customsEntries).where(inArray(customsEntries.clientId, ids)) : [],
  ]);
  return rows.map((c) => ({
    ...c,
    alerts: clientAlerts(c),
    approvedItems: items.filter((i) => i.clientId === c.id && i.status === "APPROVED").length,
    openEntries: entries.filter((e) => e.clientId === c.id && !["RELEASED", "CLOSED"].includes(e.status)).length,
  }));
}

export interface ClientAlert {
  code: string;
  severity: "BLOCKER" | "WARNING";
  text: string;
}

/** Compliance gaps on a client record, from the broker's own data. */
export function clientAlerts(c: typeof customsClients.$inferSelect, now = new Date()): ClientAlert[] {
  const out: ClientAlert[] = [];
  const in30 = now.getTime() + 30 * 86400_000;
  if (c.poaStatus === "NONE" || c.poaStatus === "REVOKED") out.push({ code: "POA_MISSING", severity: "BLOCKER", text: "No valid power of attorney on file" });
  else if (c.poaStatus === "EXPIRED" || (c.poaExpiresAt && c.poaExpiresAt < now)) out.push({ code: "POA_EXPIRED", severity: "BLOCKER", text: "Power of attorney has expired" });
  else if (c.poaStatus === "RECEIVED") out.push({ code: "POA_UNVERIFIED", severity: "WARNING", text: "Power of attorney received but not yet verified by a licensed broker" });
  else if (c.poaExpiresAt && c.poaExpiresAt.getTime() < in30) out.push({ code: "POA_EXPIRING", severity: "WARNING", text: "Power of attorney expires within 30 days" });
  if (c.bondType === "NONE") out.push({ code: "BOND_NONE", severity: "WARNING", text: "No bond recorded. Confirm bond coverage before filing" });
  else if (c.bondExpiresAt && c.bondExpiresAt < now) out.push({ code: "BOND_EXPIRED", severity: "BLOCKER", text: "Recorded bond has expired" });
  else if (c.bondExpiresAt && c.bondExpiresAt.getTime() < in30) out.push({ code: "BOND_EXPIRING", severity: "WARNING", text: "Bond expires within 30 days" });
  if (c.bondType !== "NONE" && c.bondSource === "SELF_REPORTED") out.push({ code: "BOND_SELF_REPORTED", severity: "WARNING", text: "Bond details are self-reported, not reviewed against a document" });
  if (!c.iorNumber) out.push({ code: "IOR_MISSING", severity: "WARNING", text: "Importer of record number not recorded" });
  return out;
}

export async function getClient(ctx: Ctx, clientId: string) {
  requirePerm(ctx, "customs.read");
  const c = await brokerClient(ctx, clientId);
  const [library, entries, approvers] = await Promise.all([
    ctx.db.select().from(classificationItems).where(eq(classificationItems.clientId, c.id)).orderBy(asc(classificationItems.status), desc(classificationItems.timesUsed)),
    ctx.db
      .select({ entry: customsEntries, reference: shipments.reference, title: shipments.title })
      .from(customsEntries)
      .innerJoin(shipments, eq(shipments.id, customsEntries.shipmentId))
      .where(eq(customsEntries.clientId, c.id))
      .orderBy(desc(customsEntries.createdAt)),
    ctx.db.select({ id: users.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.org.id)),
  ]);
  const sids = entries.map((x) => x.entry.shipmentId);
  const poaDocuments = sids.length
    ? await ctx.db
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(and(inArray(documents.shipmentId, sids), eq(documents.category, "POWER_OF_ATTORNEY"), isNull(documents.deletedAt)))
    : [];
  return { client: c, alerts: clientAlerts(c), library, entries, poaDocuments, users: Object.fromEntries(approvers.map((u) => [u.id, u.name])) };
}

export async function createClient(ctx: Ctx, input: z.infer<typeof customsClientSchema>) {
  requirePerm(ctx, "customs.manage");
  if (input.importerOrgId) {
    const [o] = await ctx.db.select().from(organizations).where(eq(organizations.id, input.importerOrgId));
    if (!o || o.type !== "SHIPPER") throw new AppError("VALIDATION_FAILED", "The linked organization must be an importer/shipper");
  }
  const [c] = await ctx.db
    .insert(customsClients)
    .values({ brokerOrgId: ctx.org.id, ...input, createdBy: ctx.user.id })
    .onConflictDoNothing()
    .returning();
  if (!c) throw conflict("This importer is already a client");
  await audit(ctx, "customs.client_created", "customs_client", c.id, { after: { name: c.name } });
  return c;
}

export async function updateClient(ctx: Ctx, clientId: string, input: Partial<z.infer<typeof customsClientSchema>>) {
  requirePerm(ctx, "customs.manage");
  const c = await brokerClient(ctx, clientId);
  const [u] = await ctx.db.update(customsClients).set(input).where(eq(customsClients.id, c.id)).returning();
  await audit(ctx, "customs.client_updated", "customs_client", c.id, { before: c, after: input });
  return u;
}

/** Recording or verifying a power of attorney. Marking it VERIFIED is a licensed-broker decision. */
export async function setPowerOfAttorney(ctx: Ctx, clientId: string, input: z.infer<typeof poaSchema>) {
  requirePerm(ctx, "customs.manage");
  if (input.status === "VERIFIED") requirePerm(ctx, "customs.approve");
  const c = await brokerClient(ctx, clientId);
  if (input.documentId) {
    const [d] = await ctx.db.select().from(documents).where(eq(documents.id, input.documentId));
    if (!d) throw notFound("Document");
  }
  if (input.status === "VERIFIED" && !input.documentId && !c.poaDocumentId) throw conflict("Attach the signed power of attorney before verifying it");
  const patch = {
    poaStatus: input.status,
    poaDocumentId: input.documentId ?? c.poaDocumentId,
    poaSignedAt: input.signedAt ?? c.poaSignedAt,
    poaExpiresAt: input.expiresAt ?? c.poaExpiresAt,
    ...(input.status === "VERIFIED" ? { poaVerifiedBy: ctx.user.id, poaVerifiedAt: new Date() } : {}),
  };
  await ctx.db.update(customsClients).set(patch).where(eq(customsClients.id, c.id));
  await audit(ctx, "customs.poa_updated", "customs_client", c.id, { before: { poaStatus: c.poaStatus }, after: { poaStatus: input.status } });
}

/** Find or create the client record for an importer when a customs file is opened. */
export async function ensureClientForImporter(ctx: Ctx, importerOrgId: string, name: string) {
  const [existing] = await ctx.db.select().from(customsClients).where(and(eq(customsClients.brokerOrgId, ctx.org.id), eq(customsClients.importerOrgId, importerOrgId)));
  if (existing) return existing;
  const [c] = await ctx.db.insert(customsClients).values({ brokerOrgId: ctx.org.id, importerOrgId, name, createdBy: ctx.user.id }).returning();
  await audit(ctx, "customs.client_created", "customs_client", c.id, { after: { name, auto: true } });
  return c;
}

/* ================================================================ Classification library */

export async function createClassification(ctx: Ctx, input: z.infer<typeof classificationSchema>) {
  requirePerm(ctx, "customs.manage");
  await brokerClient(ctx, input.clientId);
  const [row] = await ctx.db.insert(classificationItems).values({ brokerOrgId: ctx.org.id, ...input, status: "DRAFT", createdBy: ctx.user.id }).returning();
  await audit(ctx, "classification.drafted", "classification_item", row.id, { after: { htsCode: row.htsCode, source: row.source } });
  return row;
}

/** Only a licensed broker can make a classification reusable. */
export async function decideClassification(ctx: Ctx, itemId: string, decision: "APPROVED" | "RETIRED") {
  requirePerm(ctx, "customs.approve");
  const [it] = await ctx.db.select().from(classificationItems).where(and(eq(classificationItems.id, itemId), eq(classificationItems.brokerOrgId, ctx.org.id)));
  if (!it) throw notFound("Classification");
  if (decision === "APPROVED" && it.status === "APPROVED") return it;
  const [u] = await ctx.db
    .update(classificationItems)
    .set(decision === "APPROVED" ? { status: "APPROVED", approvedBy: ctx.user.id, approvedAt: new Date() } : { status: "RETIRED" })
    .where(eq(classificationItems.id, it.id))
    .returning();
  await audit(ctx, `classification.${decision.toLowerCase()}`, "classification_item", it.id, { before: { status: it.status }, after: { status: decision, htsCode: it.htsCode } });
  return u;
}

/** Precedents from the client's approved library plus (if configured) unverified AI candidates for one line. */
export async function classificationAssist(ctx: Ctx, entryId: string, lineId: string) {
  requirePerm(ctx, "customs.manage");
  const e = await brokerEntry(ctx, entryId);
  const [line] = await ctx.db.select().from(customsLines).where(and(eq(customsLines.id, lineId), eq(customsLines.entryId, e.id)));
  if (!line) throw notFound("Line");
  const library = e.clientId
    ? await ctx.db.select().from(classificationItems).where(and(eq(classificationItems.clientId, e.clientId), eq(classificationItems.status, "APPROVED")))
    : [];
  const precedents = matchPrecedents({ partNumber: line.partNumber, description: line.description, countryOfOrigin: line.countryOfOrigin }, library, 5);
  const ai = can(ctx, "ai.use") ? await suggestClassification(line) : { engine: "none" as const, candidates: [], questions: [], note: "Your role does not include AI assistance." };
  return { line, precedents, ai };
}

/** Use an approved library classification on a line. The line still needs a licensed broker's review. */
export async function applyClassification(ctx: Ctx, entryId: string, lineId: string, itemId: string) {
  requirePerm(ctx, "customs.manage");
  const e = await brokerEntry(ctx, entryId);
  if (LOCKED.includes(e.status)) throw conflict("This entry is locked after submission");
  const [it] = await ctx.db.select().from(classificationItems).where(and(eq(classificationItems.id, itemId), eq(classificationItems.brokerOrgId, ctx.org.id)));
  if (!it || it.status !== "APPROVED") throw conflict("Only approved classifications can be applied");
  if (e.clientId && it.clientId !== e.clientId) throw conflict("That classification belongs to a different client");
  const res = await ctx.db
    .update(customsLines)
    .set({ htsCode: it.htsCode, classificationItemId: it.id, brokerReviewed: false, reviewedBy: null, reviewedAt: null })
    .where(and(eq(customsLines.id, lineId), eq(customsLines.entryId, e.id)))
    .returning();
  if (!res.length) throw notFound("Line");
  await ctx.db.update(classificationItems).set({ timesUsed: sql`${classificationItems.timesUsed} + 1`, lastUsedAt: new Date() }).where(eq(classificationItems.id, it.id));
  await audit(ctx, "customs.classification_applied", "customs_line", lineId, { after: { htsCode: it.htsCode, classificationItemId: it.id } });
  return res[0];
}

/** Save a reviewed line's classification into the client's library as an approved precedent. */
export async function saveLineToLibrary(ctx: Ctx, entryId: string, lineId: string, rationale: string | null) {
  requirePerm(ctx, "customs.approve");
  const e = await brokerEntry(ctx, entryId);
  if (!e.clientId) throw conflict("Link this entry to a client first");
  const [line] = await ctx.db.select().from(customsLines).where(and(eq(customsLines.id, lineId), eq(customsLines.entryId, e.id)));
  if (!line) throw notFound("Line");
  if (!line.htsCode || !line.brokerReviewed) throw conflict("Only broker-reviewed lines with a classification can be saved");
  const [row] = await ctx.db
    .insert(classificationItems)
    .values({
      brokerOrgId: ctx.org.id,
      clientId: e.clientId,
      partNumber: line.partNumber,
      description: line.description,
      htsCode: line.htsCode,
      countryOfOrigin: line.countryOfOrigin,
      status: "APPROVED",
      source: "BROKER",
      rationale,
      approvedBy: ctx.user.id,
      approvedAt: new Date(),
      timesUsed: 1,
      lastUsedAt: new Date(),
      createdBy: ctx.user.id,
    })
    .returning();
  await ctx.db.update(customsLines).set({ classificationItemId: row.id }).where(eq(customsLines.id, line.id));
  await audit(ctx, "classification.approved", "classification_item", row.id, { after: { htsCode: row.htsCode, fromLine: line.id } });
  return row;
}

/* ================================================================ Lines from extracted invoice items */

export async function createLinesFromExtraction(ctx: Ctx, entryId: string, extractionId: string, indexes: number[]) {
  requirePerm(ctx, "customs.manage");
  const e = await brokerEntry(ctx, entryId);
  if (LOCKED.includes(e.status)) throw conflict("This entry is locked after submission");
  const [ex] = await ctx.db.select().from(documentExtractions).where(and(eq(documentExtractions.id, extractionId), eq(documentExtractions.orgId, ctx.org.id)));
  if (!ex) throw notFound("Extraction");
  const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, ex.documentId));
  if (!doc || doc.shipmentId !== e.shipmentId) throw conflict("That document belongs to a different shipment");
  const picked = [...new Set(indexes)].map((i) => ex.lineItems[i]).filter(Boolean);
  if (!picked.length) throw new AppError("VALIDATION_FAILED", "Choose at least one extracted line");
  const library = e.clientId ? await ctx.db.select().from(classificationItems).where(and(eq(classificationItems.clientId, e.clientId), eq(classificationItems.status, "APPROVED"))) : [];
  const [{ n }] = await ctx.db.select({ n: sql<number>`coalesce(max(${customsLines.lineNumber}), 0)::int` }).from(customsLines).where(eq(customsLines.entryId, e.id));
  const created = [];
  let next = n;
  for (const it of picked) {
    // Exact part-number precedent pre-fills the classification; the line still requires broker review.
    const exact = it.partNumber ? library.find((l) => l.partNumber && l.partNumber.toUpperCase() === it.partNumber!.toUpperCase()) : undefined;
    const coo = it.countryOfOrigin && /^[A-Za-z]{2}$/.test(it.countryOfOrigin.trim()) ? it.countryOfOrigin.trim().toUpperCase() : e.countryOfOrigin && /^[A-Z]{2}$/.test(e.countryOfOrigin) ? e.countryOfOrigin : null;
    const [row] = await ctx.db
      .insert(customsLines)
      .values({
        entryId: e.id,
        lineNumber: ++next,
        partNumber: it.partNumber,
        description: it.description.slice(0, 300),
        quantity: it.quantity != null && Number.isSafeInteger(it.quantity) ? it.quantity : null,
        valueMinor: moneyFromText(it.amount),
        countryOfOrigin: coo,
        htsCode: exact?.htsCode ?? null,
        classificationItemId: exact?.id ?? null,
        brokerReviewed: false,
        sourceExtractionId: ex.id,
      })
      .returning();
    if (exact) await ctx.db.update(classificationItems).set({ timesUsed: sql`${classificationItems.timesUsed} + 1`, lastUsedAt: new Date() }).where(eq(classificationItems.id, exact.id));
    created.push(row);
  }
  await audit(ctx, "customs.lines_from_extraction", "customs_entry", e.id, { after: { extractionId: ex.id, count: created.length } });
  return { created: created.length, prefilled: created.filter((c) => c.classificationItemId).length };
}

/* ================================================================ Entry details & deadlines */

export async function ensureDeadlineRules(ctx: Ctx) {
  const existing = await ctx.db.select({ key: customsDeadlineRules.key }).from(customsDeadlineRules).where(eq(customsDeadlineRules.brokerOrgId, ctx.org.id));
  if (existing.length) return;
  await ctx.db.insert(customsDeadlineRules).values(DEFAULT_DEADLINE_RULES.map((r) => ({ brokerOrgId: ctx.org.id, ...r, isDefaultTemplate: true }))).onConflictDoNothing();
}

export async function listDeadlineRules(ctx: Ctx) {
  requirePerm(ctx, "customs.read");
  await ensureDeadlineRules(ctx);
  return ctx.db.select().from(customsDeadlineRules).where(eq(customsDeadlineRules.brokerOrgId, ctx.org.id)).orderBy(asc(customsDeadlineRules.key));
}

export async function updateDeadlineRule(ctx: Ctx, ruleId: string, input: z.infer<typeof deadlineRuleSchema>) {
  requirePerm(ctx, "customs.approve");
  const [r] = await ctx.db.select().from(customsDeadlineRules).where(and(eq(customsDeadlineRules.id, ruleId), eq(customsDeadlineRules.brokerOrgId, ctx.org.id)));
  if (!r) throw notFound("Deadline rule");
  const [u] = await ctx.db.update(customsDeadlineRules).set({ ...input, isDefaultTemplate: false }).where(eq(customsDeadlineRules.id, r.id)).returning();
  await audit(ctx, "customs.deadline_rule_updated", "customs_deadline_rule", r.id, { before: r, after: input });
  // Recompute open deadlines on active entries.
  const active = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.brokerOrgId, ctx.org.id), ne(customsEntries.status, "CLOSED")));
  for (const e of active) await recomputeDeadlines(ctx, e);
  return u;
}

/** (Re)compute deadlines for an entry from the brokerage's rules. Completed or waived deadlines are kept as-is. */
export async function recomputeDeadlines(ctx: Ctx, entry: typeof customsEntries.$inferSelect) {
  await ensureDeadlineRules(ctx);
  const rules = await ctx.db.select().from(customsDeadlineRules).where(and(eq(customsDeadlineRules.brokerOrgId, ctx.org.id), eq(customsDeadlineRules.enabled, true)));
  const existing = await ctx.db.select().from(customsDeadlines).where(eq(customsDeadlines.entryId, entry.id));
  const anchors: Partial<Record<DeadlineAnchor, Date | null>> = {
    VESSEL_DEPARTURE: entry.vesselDepartureAt,
    ARRIVAL: entry.arrivalAt,
    RELEASE: entry.releasedAt,
    ENTRY_OPENED: entry.createdAt,
  };
  for (const r of rules) {
    const cur = existing.find((d) => d.ruleKey === r.key);
    if (cur && cur.status !== "OPEN") continue;
    const applies = !r.modes.length || r.modes.includes(entry.modeOfTransport);
    const due = applies ? computeDueAt(r, anchors) : null;
    if (!due) {
      if (cur) await ctx.db.delete(customsDeadlines).where(eq(customsDeadlines.id, cur.id));
      continue;
    }
    if (cur) await ctx.db.update(customsDeadlines).set({ dueAt: due, label: r.label, reference: r.reference }).where(eq(customsDeadlines.id, cur.id));
    else await ctx.db.insert(customsDeadlines).values({ entryId: entry.id, brokerOrgId: ctx.org.id, ruleKey: r.key, label: r.label, reference: r.reference, dueAt: due });
  }
  // Rules that were disabled drop their open deadlines.
  for (const d of existing) if (d.status === "OPEN" && !rules.some((r) => r.key === d.ruleKey)) await ctx.db.delete(customsDeadlines).where(eq(customsDeadlines.id, d.id));
}

export async function updateEntryDetails(ctx: Ctx, entryId: string, input: z.infer<typeof entryDetailsSchema>) {
  requirePerm(ctx, "customs.manage");
  const e = await brokerEntry(ctx, entryId);
  if (input.clientId) await brokerClient(ctx, input.clientId);
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [u] = await ctx.db.update(customsEntries).set(patch).where(eq(customsEntries.id, e.id)).returning();
  await recomputeDeadlines(ctx, u);
  if (input.releasedAt && !e.releasedAt) {
    await recordEvent(ctx, e.shipmentId, { type: "CUSTOMS_RELEASE_RECORDED", title: "Customs release recorded by broker", customerTracking: true });
  }
  await audit(ctx, "customs.entry_details_updated", "customs_entry", e.id, { before: { entryNumber: e.entryNumber, arrivalAt: e.arrivalAt, releasedAt: e.releasedAt }, after: patch });
  return u;
}

export async function setDeadlineStatus(ctx: Ctx, deadlineId: string, input: z.infer<typeof deadlineStatusSchema>) {
  requirePerm(ctx, "customs.manage");
  if (input.status === "WAIVED") requirePerm(ctx, "customs.approve");
  const [d] = await ctx.db.select().from(customsDeadlines).where(and(eq(customsDeadlines.id, deadlineId), eq(customsDeadlines.brokerOrgId, ctx.org.id)));
  if (!d) throw notFound("Deadline");
  await ctx.db
    .update(customsDeadlines)
    .set(input.status === "OPEN" ? { status: "OPEN", completedBy: null, completedAt: null, note: input.note } : { status: input.status, completedBy: ctx.user.id, completedAt: new Date(), note: input.note })
    .where(eq(customsDeadlines.id, d.id));
  await audit(ctx, "customs.deadline_status", "customs_deadline", d.id, { before: { status: d.status }, after: input });
}

/* ================================================================ Pre-filing review */

async function entryInputs(ctx: Ctx, e: typeof customsEntries.$inferSelect) {
  const [shipment] = await ctx.db.select().from(shipments).where(eq(shipments.id, e.shipmentId));
  const [lines, reqs, docs, extractions, deadlines, client] = await Promise.all([
    ctx.db.select().from(customsLines).where(eq(customsLines.entryId, e.id)).orderBy(asc(customsLines.lineNumber)),
    ctx.db.select().from(documentRequirements).where(eq(documentRequirements.shipmentId, e.shipmentId)),
    ctx.db
      .select({ doc: documents, version: documentVersions })
      .from(documents)
      .leftJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion)))
      .where(and(eq(documents.shipmentId, e.shipmentId), isNull(documents.deletedAt))),
    ctx.db.select().from(documentExtractions).where(eq(documentExtractions.orgId, ctx.org.id)).orderBy(desc(documentExtractions.createdAt)),
    ctx.db.select().from(customsDeadlines).where(eq(customsDeadlines.entryId, e.id)).orderBy(asc(customsDeadlines.dueAt)),
    e.clientId ? ctx.db.select().from(customsClients).where(eq(customsClients.id, e.clientId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const docIds = new Set(docs.map((d) => d.doc.id));
  const exs = extractions.filter((x) => docIds.has(x.documentId));
  const library = client ? await ctx.db.select().from(classificationItems).where(and(eq(classificationItems.clientId, client.id), eq(classificationItems.status, "APPROVED"))) : [];
  return { shipment, lines, reqs, docs, extractions: exs, deadlines, client, library };
}

/** Fingerprint of everything the review looked at, so a later change marks the review stale. */
function inputHash(x: Awaited<ReturnType<typeof entryInputs>>, e: typeof customsEntries.$inferSelect) {
  const h = createHash("sha256");
  h.update(JSON.stringify([e.declaredValueMinor, e.countryOfOrigin, e.clientId]));
  for (const l of x.lines) h.update(JSON.stringify([l.id, l.htsCode, l.valueMinor, l.quantity, l.countryOfOrigin, l.brokerReviewed, l.description]));
  for (const d of x.docs) h.update(`${d.doc.id}:${d.doc.currentVersion}`);
  for (const r of x.reqs) h.update(`${r.id}:${r.status}`);
  for (const ex of x.extractions) h.update(`${ex.id}:${ex.reviewStatus}`);
  if (x.client) h.update(JSON.stringify([x.client.poaStatus, x.client.poaExpiresAt, x.client.bondType, x.client.bondExpiresAt]));
  return h.digest("hex");
}

const money = (m: number) => `$${(m / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Deterministic, explainable checks. Each finding names the evidence that triggered it. */
export function ruleFindings(x: Awaited<ReturnType<typeof entryInputs>>, e: typeof customsEntries.$inferSelect, now = new Date()): Omit<ReviewFinding, "id" | "resolution">[] {
  const f: Omit<ReviewFinding, "id" | "resolution">[] = [];
  const add = (code: string, severity: ReviewFinding["severity"], title: string, detail: string, evidence: ReviewFinding["evidence"] = []) => f.push({ code, severity, title, detail, evidence, origin: "RULE" });

  // Documents
  for (const r of x.reqs.filter((r) => r.status === "REQUESTED")) {
    add(`DOC_MISSING:${r.category}`, ["COMMERCIAL_INVOICE", "POWER_OF_ATTORNEY"].includes(r.category) ? "BLOCKER" : "WARNING", `${categoryLabel(r.category)} not received`, "This document was requested from the importer and has not been uploaded.", [
      { kind: "document", label: `Request: ${categoryLabel(r.category)}`, ref: r.id, snippet: r.dueAt ? `Due ${r.dueAt.toISOString().slice(0, 10)}` : undefined },
    ]);
  }
  const pending = x.extractions.filter((ex) => ex.status === "COMPLETED" && ex.reviewStatus === "PENDING_REVIEW");
  if (pending.length) add("EXTRACTION_UNREVIEWED", "WARNING", `${pending.length} AI extraction${pending.length > 1 ? "s" : ""} awaiting review`, "Extracted values are drafts until a person approves them.", pending.map((p) => ({ kind: "extraction" as const, label: categoryLabel(x.docs.find((d) => d.doc.id === p.documentId)?.doc.category ?? ""), ref: p.id })));

  // Cross-document discrepancies
  for (const d of findDiscrepancies(x.extractions, x.docs.map((d) => d.doc), x.shipment)) {
    add(`DISCREPANCY:${d.field}`, d.severity === "warning" ? "WARNING" : "INFO", `${d.label} differs across documents`, d.explanation, d.values.map((v) => ({ kind: "document" as const, label: `${v.source}: ${v.value}`, ref: v.documentId, snippet: v.snippet })));
  }

  // Lines
  if (!x.lines.length) add("NO_LINES", "BLOCKER", "No entry lines", "Add the entry lines (or create them from the commercial invoice) before filing.");
  for (const l of x.lines) {
    const ev = [{ kind: "line" as const, label: `Line ${l.lineNumber || ""} ${l.description}`.trim(), ref: l.id }];
    if (!l.htsCode) add(`LINE_UNCLASSIFIED:${l.id}`, "BLOCKER", `Line ${l.lineNumber}: no classification`, "Every line needs a 10-digit HTSUS number chosen by the broker.", ev);
    else if (!normalizeHts(l.htsCode)) add(`LINE_HTS_FORMAT:${l.id}`, "BLOCKER", `Line ${l.lineNumber}: classification is not a 10-digit number`, `"${l.htsCode}" is not in 0000.00.0000 form.`, ev);
    if (!l.brokerReviewed) add(`LINE_UNREVIEWED:${l.id}`, "BLOCKER", `Line ${l.lineNumber}: not reviewed by a licensed broker`, "A licensed broker must review each line.", ev);
    if (l.valueMinor == null) add(`LINE_NO_VALUE:${l.id}`, "BLOCKER", `Line ${l.lineNumber}: no value`, "Enter the line value from the commercial invoice.", ev);
    if (!l.countryOfOrigin) add(`LINE_NO_ORIGIN:${l.id}`, "WARNING", `Line ${l.lineNumber}: no country of origin`, "Record the country of origin for each line.", ev);
    else if (e.countryOfOrigin && /^[A-Z]{2}$/.test(e.countryOfOrigin) && l.countryOfOrigin !== e.countryOfOrigin) add(`LINE_ORIGIN_DIFFERS:${l.id}`, "INFO", `Line ${l.lineNumber}: origin ${l.countryOfOrigin} differs from the entry (${e.countryOfOrigin})`, "Mixed origins are possible; confirm with the importer.", ev);
    // Consistency with the client's own approved classifications.
    const sameParts = l.partNumber ? x.library.filter((p) => p.partNumber && p.partNumber.toUpperCase() === l.partNumber!.toUpperCase()) : [];
    const conflicting = sameParts.find((p) => l.htsCode && p.htsCode !== l.htsCode);
    if (conflicting) {
      add(`LINE_INCONSISTENT:${l.id}`, "WARNING", `Line ${l.lineNumber}: differs from this client's approved classification`, `Part ${l.partNumber} was previously approved as ${conflicting.htsCode}; this line uses ${l.htsCode}. Confirm which is correct, or record why it changed.`, [
        ...ev,
        { kind: "library", label: `Approved ${conflicting.htsCode}`, ref: conflicting.id, snippet: conflicting.description },
      ]);
    }
  }

  // Value reconciliation against the approved commercial invoice total
  const lineTotal = x.lines.reduce((a, l) => a + (l.valueMinor ?? 0), 0);
  const ciDoc = x.docs.find((d) => d.doc.category === "COMMERCIAL_INVOICE");
  const ciEx = ciDoc ? x.extractions.find((ex) => ex.documentId === ciDoc.doc.id && ex.status === "COMPLETED") : undefined;
  const ciTotalText = ciEx?.approvedFields?.total_value ?? ciEx?.fields.find((fl) => fl.key === "total_value")?.value;
  const ciTotal = moneyFromText(ciTotalText);
  if (x.lines.length && ciTotal != null && Math.abs(lineTotal - ciTotal) > Math.max(100, ciTotal * 0.005)) {
    add("VALUE_MISMATCH", "WARNING", "Line values do not add up to the invoice total", `Lines total ${money(lineTotal)}; the commercial invoice shows ${money(ciTotal)}.`, [
      { kind: "document", label: "Commercial invoice total", ref: ciDoc!.doc.id, snippet: ciEx?.fields.find((fl) => fl.key === "total_value")?.source.snippet },
    ]);
  }
  if (x.lines.length && e.declaredValueMinor != null && Math.abs(lineTotal - e.declaredValueMinor) > Math.max(100, e.declaredValueMinor * 0.005)) {
    add("DECLARED_VALUE_MISMATCH", "WARNING", "Line values differ from the declared entry value", `Lines total ${money(lineTotal)}; declared value is ${money(e.declaredValueMinor)}.`, [{ kind: "entry", label: "Declared value" }]);
  }

  // Client compliance
  if (!x.client) add("NO_CLIENT", "WARNING", "Entry is not linked to a client record", "Link the importer's client record so power of attorney and bond can be checked.");
  else for (const a of clientAlerts(x.client, now)) add(`CLIENT:${a.code}`, a.severity, a.text, `From the client record for ${x.client.name}.`, [{ kind: "client", label: x.client.name, ref: x.client.id }]);

  // Deadlines
  for (const d of x.deadlines) {
    const st = deadlineState(d.dueAt, d.status, now);
    if (st === "overdue") add(`DEADLINE_OVERDUE:${d.ruleKey}`, "WARNING", `Overdue: ${d.label}`, `Was due ${d.dueAt.toISOString().replace("T", " ").slice(0, 16)} UTC.`, [{ kind: "deadline", label: d.label, ref: d.id, snippet: d.reference ?? undefined }]);
    else if (st === "due_soon") add(`DEADLINE_SOON:${d.ruleKey}`, "INFO", `Due within 48 hours: ${d.label}`, `Due ${d.dueAt.toISOString().replace("T", " ").slice(0, 16)} UTC.`, [{ kind: "deadline", label: d.label, ref: d.id, snippet: d.reference ?? undefined }]);
  }
  return f;
}

/** Text passages from the file for AI review and Q&A. Document text is untrusted and labeled with its source. */
async function filePassages(x: Awaited<ReturnType<typeof entryInputs>>, e: typeof customsEntries.$inferSelect): Promise<Passage[]> {
  const out: Passage[] = [];
  for (const d of x.docs.slice(0, 12)) {
    if (!d.version || d.version.purgedAt) continue;
    try {
      const text = await documentText(await storage().get(d.version.storageKey), d.version.mimeType);
      if (text.trim()) out.push({ id: `doc:${d.doc.id}`, label: `${categoryLabel(d.doc.category)}: ${d.doc.title}`, text: text.slice(0, 20_000) });
    } catch {
      /* unreadable file: skipped */
    }
  }
  if (x.lines.length) {
    out.push({
      id: "lines",
      label: "Entry lines",
      text: x.lines.map((l) => `Line ${l.lineNumber}: ${l.partNumber ?? ""} ${l.description}; HTS ${l.htsCode ?? "none"}; qty ${l.quantity ?? "—"}; value ${l.valueMinor != null ? money(l.valueMinor) : "—"}; origin ${l.countryOfOrigin ?? "—"}; ${l.brokerReviewed ? "broker reviewed" : "not reviewed"}`).join("\n"),
    });
  }
  if (x.deadlines.length) out.push({ id: "deadlines", label: "Deadlines", text: x.deadlines.map((d) => `${d.label}: due ${d.dueAt.toISOString().slice(0, 16)} UTC, ${d.status}. ${d.reference ?? ""}`).join("\n") });
  if (x.client)
    out.push({
      id: "client",
      label: `Client: ${x.client.name}`,
      text: `Power of attorney: ${x.client.poaStatus}${x.client.poaExpiresAt ? `, expires ${x.client.poaExpiresAt.toISOString().slice(0, 10)}` : ""}. Bond: ${x.client.bondType}${x.client.bondExpiresAt ? `, expires ${x.client.bondExpiresAt.toISOString().slice(0, 10)}` : ""} (${x.client.bondSource}).`,
    });
  out.push({ id: "entry", label: "Entry record", text: `Status ${e.status}. Port ${e.portOfEntry ?? "—"}. Arrival ${e.arrivalAt?.toISOString().slice(0, 16) ?? "—"} UTC. Entry type ${e.entryType ?? "—"}. Mode ${e.modeOfTransport}. Country of origin ${e.countryOfOrigin ?? "—"}.` });
  return out;
}

export async function runPreflightReview(ctx: Ctx, entryId: string) {
  requirePerm(ctx, "customs.manage");
  const e = await brokerEntry(ctx, entryId);
  const x = await entryInputs(ctx, e);
  const prev = await latestReview(ctx, e.id);
  const findings: ReviewFinding[] = ruleFindings(x, e).map((f) => {
    // Keep a person's earlier acknowledgement when the same finding recurs unchanged.
    const old = prev?.findings.find((p) => p.code === f.code && p.detail === f.detail);
    return { ...f, id: randomUUID(), resolution: old?.resolution ?? null };
  });
  let engine = "rules";
  if (can(ctx, "ai.use")) {
    const obs = await reviewObservations(await filePassages(x, e));
    if (obs.engine !== "demo-rules") engine = `rules+${obs.engine}`;
    for (const o of obs.observations) {
      findings.push({ id: randomUUID(), code: `AI:${createHash("sha1").update(o.title).digest("hex").slice(0, 10)}`, severity: o.severity, title: o.title, detail: o.detail, origin: "AI", resolution: null, evidence: o.evidence.map((ev) => ({ kind: "document" as const, label: ev.label, snippet: ev.snippet })) });
    }
  }
  const [row] = await ctx.db
    .insert(customsReviews)
    .values({ entryId: e.id, brokerOrgId: ctx.org.id, engine, score: readinessScore(findings), findings, inputHash: inputHash(x, e), createdBy: ctx.user.id })
    .returning();
  await audit(ctx, "customs.review_run", "customs_entry", e.id, { after: { reviewId: row.id, score: row.score, blockers: findings.filter((f) => f.severity === "BLOCKER" && !f.resolution).length } });
  return row;
}

export async function latestReview(ctx: Ctx, entryId: string) {
  const [r] = await ctx.db.select().from(customsReviews).where(eq(customsReviews.entryId, entryId)).orderBy(desc(customsReviews.createdAt)).limit(1);
  return r ?? null;
}

/** Whether the latest review still matches the file. */
export async function reviewIsCurrent(ctx: Ctx, e: typeof customsEntries.$inferSelect, review: typeof customsReviews.$inferSelect | null) {
  if (!review) return false;
  return review.inputHash === inputHash(await entryInputs(ctx, e), e);
}

/** Acknowledge or resolve a finding with a note. Overriding a blocker is a licensed-broker decision. */
export async function resolveFinding(ctx: Ctx, entryId: string, input: z.infer<typeof resolveFindingSchema>) {
  requirePerm(ctx, "customs.manage");
  const e = await brokerEntry(ctx, entryId);
  const review = await latestReview(ctx, e.id);
  if (!review) throw notFound("Review");
  const f = review.findings.find((x) => x.id === input.findingId);
  if (!f) throw notFound("Finding");
  if (f.severity === "BLOCKER") {
    requirePerm(ctx, "customs.approve");
    if (!input.note) throw new AppError("VALIDATION_FAILED", "Explain why this blocker is acceptable");
  }
  const findings = review.findings.map((x) => (x.id === f.id ? { ...x, resolution: { status: input.status, by: ctx.user.id, at: new Date().toISOString(), note: input.note } } : x));
  await ctx.db.update(customsReviews).set({ findings, score: readinessScore(findings) }).where(eq(customsReviews.id, review.id));
  await audit(ctx, "customs.finding_resolved", "customs_review", review.id, { after: { code: f.code, severity: f.severity, status: input.status, note: input.note } });
}

/** Gate used before marking an entry ready to file. */
export async function assertReviewClear(ctx: Ctx, e: typeof customsEntries.$inferSelect) {
  const review = await latestReview(ctx, e.id);
  if (!review) throw conflict("Run the pre-filing review before marking this entry ready to file");
  if (!(await reviewIsCurrent(ctx, e, review))) throw conflict("The file changed since the last review. Run the pre-filing review again");
  const open = review.findings.filter((f) => f.severity === "BLOCKER" && !f.resolution);
  if (open.length) throw conflict(`${open.length} blocking finding${open.length > 1 ? "s" : ""} must be resolved first`, { findings: open.map((f) => f.title) });
}

/* ================================================================ Ask this file */

export async function askFile(ctx: Ctx, entryId: string, question: string) {
  requirePerm(ctx, "customs.read", "ai.use");
  const e = await brokerEntry(ctx, entryId);
  const x = await entryInputs(ctx, e);
  const res = await answerFromPassages(question, await filePassages(x, e));
  const [row] = await ctx.db
    .insert(customsQuestions)
    .values({ entryId: e.id, brokerOrgId: ctx.org.id, userId: ctx.user.id, question, answer: res.answer, citations: res.citations, engine: res.engine })
    .returning();
  return row;
}

export async function listQuestions(ctx: Ctx, entryId: string) {
  requirePerm(ctx, "customs.read");
  return ctx.db.select().from(customsQuestions).where(eq(customsQuestions.entryId, entryId)).orderBy(desc(customsQuestions.createdAt)).limit(20);
}

/* ================================================================ Brokerage billing */

/** Estimated brokerage charges from the client's fee schedule; the importer approves them like any other charge. */
export async function generateBrokerageCharges(ctx: Ctx, entryId: string) {
  requirePerm(ctx, "finance.manage");
  const e = await brokerEntry(ctx, entryId);
  if (!e.clientId) throw conflict("Link this entry to a client with a fee schedule first");
  const client = await brokerClient(ctx, e.clientId);
  const [shipment] = await ctx.db.select().from(shipments).where(eq(shipments.id, e.shipmentId));
  const existing = await ctx.db.select({ id: charges.id }).from(charges).where(and(eq(charges.shipmentId, e.shipmentId), eq(charges.billerOrgId, ctx.org.id), eq(charges.sourceId, e.id), ne(charges.status, "VOID")));
  if (existing.length) throw conflict("Brokerage charges already exist for this entry");
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(customsLines).where(eq(customsLines.entryId, e.id));
  const items: { description: string; qtyMilli: number; unitMinor: number }[] = [];
  if (client.entryFeeMinor) items.push({ description: "Customs entry preparation", qtyMilli: 1000, unitMinor: client.entryFeeMinor });
  if (client.perLineFeeMinor && n) items.push({ description: `Entry lines (${n})`, qtyMilli: n * 1000, unitMinor: client.perLineFeeMinor });
  if (client.isfFeeMinor && e.modeOfTransport === "OCEAN") items.push({ description: "Importer Security Filing", qtyMilli: 1000, unitMinor: client.isfFeeMinor });
  if (!items.length) throw conflict("This client has no fee schedule");
  const rows = await ctx.db
    .insert(charges)
    .values(
      items.map((i) => ({
        shipmentId: e.shipmentId,
        kind: "RECEIVABLE" as const,
        billerOrgId: ctx.org.id,
        billToOrgId: shipment.ownerOrgId,
        code: "CUSTOMS_BROKERAGE",
        description: i.description,
        quantityMilli: i.qtyMilli,
        unitAmountMinor: i.unitMinor,
        amountMinor: lineAmount(i.qtyMilli, i.unitMinor),
        currency: client.currency,
        status: "ESTIMATED" as const,
        source: "MANUAL" as const,
        sourceId: e.id,
        createdBy: ctx.user.id,
      })),
    )
    .returning();
  await enqueue(ctx.db, "notify.org", { orgId: shipment.ownerOrgId, type: "CHARGE_PENDING", title: `Brokerage charges awaiting approval on ${shipment.reference}`, link: `/shipments/${shipment.id}?tab=finance`, shipmentId: shipment.id });
  await audit(ctx, "customs.brokerage_charges", "customs_entry", e.id, { after: { count: rows.length, totalMinor: rows.reduce((a, r) => a + r.amountMinor, 0) } });
  return rows;
}

/* ================================================================ Entry view-model additions */

export async function entryInsights(ctx: Ctx, e: typeof customsEntries.$inferSelect) {
  const isBroker = e.brokerOrgId === ctx.org.id;
  const deadlines = await ctx.db.select().from(customsDeadlines).where(eq(customsDeadlines.entryId, e.id)).orderBy(asc(customsDeadlines.dueAt));
  if (!isBroker) return { deadlines, review: null, reviewCurrent: false, client: null, clientAlerts: [] as ClientAlert[], questions: [], library: [], dutyEstimate: null, clients: [] };
  const review = await latestReview(ctx, e.id);
  const [client, questions, clients] = await Promise.all([
    e.clientId ? ctx.db.select().from(customsClients).where(eq(customsClients.id, e.clientId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    listQuestions(ctx, e.id),
    ctx.db.select({ id: customsClients.id, name: customsClients.name }).from(customsClients).where(eq(customsClients.brokerOrgId, ctx.org.id)).orderBy(asc(customsClients.name)),
  ]);
  const library = client ? await ctx.db.select().from(classificationItems).where(and(eq(classificationItems.clientId, client.id), eq(classificationItems.status, "APPROVED"))) : [];
  const lines = await ctx.db.select().from(customsLines).where(eq(customsLines.entryId, e.id));
  const rated = lines.filter((l) => l.valueMinor != null && l.dutyRateBp != null);
  const dutyEstimate = rated.length ? { minor: rated.reduce((a, l) => a + estimateDutyMinor(l.valueMinor!, l.dutyRateBp!), 0), lines: rated.length, of: lines.length } : null;
  return { deadlines, review, reviewCurrent: await reviewIsCurrent(ctx, e, review), client, clientAlerts: client ? clientAlerts(client) : [], questions, library, dutyEstimate, clients };
}

/* ================================================================ Broker command center */

export async function brokerDashboard(ctx: Ctx) {
  requirePerm(ctx, "customs.read");
  const now = new Date();
  const entries = await ctx.db
    .select({ entry: customsEntries, reference: shipments.reference, title: shipments.title, ownerOrgId: shipments.ownerOrgId })
    .from(customsEntries)
    .innerJoin(shipments, eq(shipments.id, customsEntries.shipmentId))
    .where(eq(customsEntries.brokerOrgId, ctx.org.id))
    .orderBy(asc(customsEntries.arrivalAt));
  const ids = entries.map((x) => x.entry.id);
  const [deadlines, reviews, clientRows, staff, openTasks, lineCounts] = await Promise.all([
    ctx.db.select().from(customsDeadlines).where(eq(customsDeadlines.brokerOrgId, ctx.org.id)).orderBy(asc(customsDeadlines.dueAt)),
    ids.length ? ctx.db.select().from(customsReviews).where(inArray(customsReviews.entryId, ids)).orderBy(desc(customsReviews.createdAt)) : [],
    ctx.db.select().from(customsClients).where(eq(customsClients.brokerOrgId, ctx.org.id)),
    ctx.db.select({ id: users.id, name: users.name, roles: memberships.roles }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.status, "ACTIVE"))),
    ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), eq(tasks.status, "OPEN"))),
    ids.length
      ? ctx.db
          .select({ entryId: customsLines.entryId, n: sql<number>`count(*)::int`, reviewed: sql<number>`count(*) filter (where ${customsLines.brokerReviewed})::int` })
          .from(customsLines)
          .where(inArray(customsLines.entryId, ids))
          .groupBy(customsLines.entryId)
      : [],
  ]);
  const latestByEntry = new Map<string, (typeof reviews)[number]>();
  for (const r of reviews) if (!latestByEntry.has(r.entryId)) latestByEntry.set(r.entryId, r);
  const rows = entries.map((x) => {
    const dl = deadlines.filter((d) => d.entryId === x.entry.id && d.status === "OPEN");
    const next = dl[0] ?? null;
    const review = latestByEntry.get(x.entry.id) ?? null;
    const lc = lineCounts.find((l) => l.entryId === x.entry.id);
    return {
      ...x,
      client: clientRows.find((c) => c.id === x.entry.clientId) ?? null,
      assignee: staff.find((s) => s.id === x.entry.assignedToUserId)?.name ?? null,
      nextDeadline: next ? { label: next.label, dueAt: next.dueAt, state: deadlineState(next.dueAt, next.status, now) } : null,
      overdue: dl.filter((d) => deadlineState(d.dueAt, d.status, now) === "overdue").length,
      review: review ? { score: review.score, blockers: review.findings.filter((f) => f.severity === "BLOCKER" && !f.resolution).length, at: review.createdAt } : null,
      lines: lc?.n ?? 0,
      linesReviewed: lc?.reviewed ?? 0,
    };
  });
  const active = rows.filter((r) => !["CLOSED"].includes(r.entry.status));
  const openDeadlines = deadlines.filter((d) => d.status === "OPEN" && active.some((r) => r.entry.id === d.entryId));
  const clientIssues = clientRows.flatMap((c) => clientAlerts(c, now).map((a) => ({ client: c, alert: a }))).filter((x) => x.alert.code !== "BOND_SELF_REPORTED");
  return {
    kpis: {
      active: active.filter((r) => !["RELEASED"].includes(r.entry.status)).length,
      dueSoon: openDeadlines.filter((d) => deadlineState(d.dueAt, d.status, now) === "due_soon").length,
      overdue: openDeadlines.filter((d) => deadlineState(d.dueAt, d.status, now) === "overdue").length,
      ready: active.filter((r) => r.entry.status === "READY_TO_FILE").length,
      blockers: active.reduce((a, r) => a + (r.review?.blockers ?? 0), 0),
      clientIssues: clientIssues.filter((x) => x.alert.severity === "BLOCKER").length,
    },
    rows: active,
    deadlines: openDeadlines.slice(0, 15).map((d) => ({ ...d, state: deadlineState(d.dueAt, d.status, now), entry: rows.find((r) => r.entry.id === d.entryId)! })),
    clientIssues: clientIssues.slice(0, 12),
    workload: staff.map((s) => ({
      ...s,
      entries: active.filter((r) => r.entry.assignedToUserId === s.id).length,
      tasks: openTasks.filter((t) => t.assigneeUserId === s.id).length,
      overdueTasks: openTasks.filter((t) => t.assigneeUserId === s.id && t.dueAt && t.dueAt < now).length,
    })),
  };
}
