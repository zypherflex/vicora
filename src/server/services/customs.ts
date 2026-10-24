import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { extractText } from "unpdf";
import type { z } from "zod";
import { categoryLabel } from "@/lib/domain";
import { parseToMinor } from "@/lib/money";
import { extractFields, extractLineItems, FIELD_DEFS } from "@/server/adapters/ai";
import { storage } from "@/server/adapters/storage";
import { requirePerm, type Ctx } from "@/server/authz/context";
import type { DB } from "@/server/db/client";
import {
  customsEntries,
  customsLines,
  documentExtractions,
  documentRequirements,
  documents,
  documentVersions,
  organizations,
  shipmentParties,
  shipments,
  tasks,
  users,
  memberships,
  type ExtractedField,
} from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type { customsEntrySchema, customsLineSchema, customsStatusSchema, extractionReviewSchema, taskSchema } from "@/server/validators";
import { assertReviewClear, ensureClientForImporter, entryInsights, recomputeDeadlines } from "./brokerage";
import { audit, enqueue, recordEvent, requireParty } from "./common";
import { openException } from "./operations";

/* ---------------------------------------------------------------- Filing adapters */

export interface FilingAdapter {
  key: string;
  name: string;
  connected: boolean;
  demonstration: boolean;
  description: string;
}

/**
 * Government filing (e.g. U.S. CBP ACE via ABI) requires a certified software provider or direct ABI
 * certification, a filer code and a licensed broker. None is configured, so the real adapter reports
 * NOT_CONNECTED. The demonstration adapter records a fake reference and never contacts any agency.
 */
export const FILING_ADAPTERS: FilingAdapter[] = [
  {
    key: "ACE_ABI",
    name: "U.S. CBP ACE (ABI)",
    connected: false,
    demonstration: false,
    description: "Not connected. Requires ABI certification or an ABI software vendor, a filer code, and credentials configured by the broker.",
  },
  {
    key: "DEMO",
    name: "Demonstration adapter",
    connected: true,
    demonstration: true,
    description: "Records a simulated submission reference for training and demos. Nothing is transmitted to any government system.",
  },
];

/* ---------------------------------------------------------------- Appointment & intake */

/** The importer appoints a customs broker for its shipment. The broker then opens the entry from intake. */
export async function appointCustomsBroker(ctx: Ctx, shipmentId: string, brokerOrgId: string) {
  requirePerm(ctx, "shipment.update");
  const access = await requireParty(ctx, shipmentId);
  if (!access.isCustomer) throw new AppError("FORBIDDEN", "Only the importer can appoint a customs broker");
  if (!access.shipment.requiresCustoms) throw conflict("This shipment is not marked as requiring customs coordination");
  const [broker] = await ctx.db.select().from(organizations).where(eq(organizations.id, brokerOrgId));
  if (!broker || broker.type !== "CUSTOMS_BROKER" || broker.status !== "ACTIVE") throw new AppError("VALIDATION_FAILED", "Choose an active licensed customs broker");
  await ctx.db.insert(shipmentParties).values({ shipmentId, orgId: broker.id, role: "CUSTOMS_BROKER" }).onConflictDoNothing();
  await recordEvent(ctx, shipmentId, { type: "CUSTOMS_BROKER_APPOINTED", title: `Customs broker appointed: ${broker.name}` });
  await enqueue(ctx.db, "notify.org", { orgId: broker.id, type: "CUSTOMS_INTAKE", title: `New customs intake: ${access.shipment.reference}`, link: `/customs`, shipmentId });
  await audit(ctx, "customs.broker_appointed", "shipment", shipmentId, { after: { brokerOrgId } });
}

export async function customsWorkspace(ctx: Ctx) {
  requirePerm(ctx, "customs.read");
  const partyRows = await ctx.db
    .select({ shipment: shipments })
    .from(shipmentParties)
    .innerJoin(shipments, eq(shipments.id, shipmentParties.shipmentId))
    .where(and(eq(shipmentParties.orgId, ctx.org.id), eq(shipmentParties.role, "CUSTOMS_BROKER")))
    .orderBy(desc(shipments.updatedAt));
  const entries = await ctx.db.select().from(customsEntries).where(eq(customsEntries.brokerOrgId, ctx.org.id));
  const sids = partyRows.map((r) => r.shipment.id);
  const [reqs, openTasks, owners, staff] = await Promise.all([
    sids.length ? ctx.db.select().from(documentRequirements).where(inArray(documentRequirements.shipmentId, sids)) : [],
    ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), eq(tasks.status, "OPEN"))).orderBy(asc(tasks.dueAt)),
    ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations),
    ctx.db.select({ id: users.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.org.id)),
  ]);
  return {
    intake: partyRows.map((r) => ({
      shipment: r.shipment,
      importer: owners.find((o) => o.id === r.shipment.ownerOrgId)?.name ?? "",
      entry: entries.find((e) => e.shipmentId === r.shipment.id) ?? null,
      requirements: reqs.filter((x) => x.shipmentId === r.shipment.id),
    })),
    tasks: openTasks,
    staff,
  };
}

const DEFAULT_REQUIRED_DOCS = ["COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "POWER_OF_ATTORNEY"] as const;

export async function openCustomsEntry(ctx: Ctx, shipmentId: string, input: z.infer<typeof customsEntrySchema>) {
  requirePerm(ctx, "customs.manage");
  const access = await requireParty(ctx, shipmentId);
  if (!access.isCustomsBroker) throw new AppError("FORBIDDEN", "Your organization is not the appointed customs broker");
  const [existing] = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.shipmentId, shipmentId), eq(customsEntries.brokerOrgId, ctx.org.id)));
  if (existing) throw conflict("A customs file already exists for this shipment");
  const [importer] = await ctx.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, access.shipment.ownerOrgId));
  const client = await ensureClientForImporter(ctx, access.shipment.ownerOrgId, importer?.name ?? "Importer");
  const [entry] = await ctx.db
    .insert(customsEntries)
    .values({
      shipmentId,
      brokerOrgId: ctx.org.id,
      status: "DOCS_PENDING",
      portOfEntry: input.portOfEntry ?? access.shipment.portOfEntry,
      arrivalAt: input.arrivalAt ?? access.shipment.portEta,
      importerName: input.importerName ?? importer?.name ?? null,
      countryOfOrigin: access.shipment.countryOfOrigin,
      assignedToUserId: input.assignedToUserId ?? ctx.user.id,
      brokerNotes: input.brokerNotes,
      clientId: client.id,
      // Port-to-door files arrive by sea; the broker corrects the mode in entry details when it differs.
      modeOfTransport: access.shipment.portOfEntry ? "OCEAN" : "TRUCK",
    })
    .returning();
  await recomputeDeadlines(ctx, entry);
  // Standard document checklist; the broker can add or waive items.
  const have = await ctx.db.select({ category: documents.category }).from(documents).where(and(eq(documents.shipmentId, shipmentId), isNull(documents.deletedAt)));
  for (const cat of DEFAULT_REQUIRED_DOCS) {
    await ctx.db.insert(documentRequirements).values({
      shipmentId,
      requestedByOrgId: ctx.org.id,
      category: cat,
      status: have.some((h) => h.category === cat) ? "RECEIVED" : "REQUESTED",
      dueAt: entry.arrivalAt ? new Date(entry.arrivalAt.getTime() - 2 * 86400_000) : null,
    });
  }
  await ctx.db.insert(tasks).values({
    orgId: ctx.org.id,
    shipmentId,
    customsEntryId: entry.id,
    title: `Review documents for ${access.shipment.reference}`,
    assigneeUserId: entry.assignedToUserId,
    dueAt: entry.arrivalAt ? new Date(entry.arrivalAt.getTime() - 86400_000) : new Date(Date.now() + 2 * 86400_000),
    priority: "HIGH",
    createdBy: ctx.user.id,
  });
  await recordEvent(ctx, shipmentId, { type: "CUSTOMS_OPENED", title: "Customs file opened; documents requested", customerTracking: false });
  await enqueue(ctx.db, "notify.org", { orgId: access.shipment.ownerOrgId, type: "DOCUMENT_REQUESTED", title: `Customs documents needed for ${access.shipment.reference}`, link: `/shipments/${shipmentId}?tab=documents`, shipmentId });
  await audit(ctx, "customs.entry_opened", "customs_entry", entry.id);
  return entry;
}

export async function getCustomsFile(ctx: Ctx, entryId: string) {
  requirePerm(ctx, "customs.read");
  const [entry] = await ctx.db.select().from(customsEntries).where(eq(customsEntries.id, entryId));
  if (!entry) throw notFound("Customs file");
  const isBroker = entry.brokerOrgId === ctx.org.id;
  const [shipment] = await ctx.db.select().from(shipments).where(eq(shipments.id, entry.shipmentId));
  const [lines, reqs, docs, extractions, entryTasks] = await Promise.all([
    ctx.db.select().from(customsLines).where(eq(customsLines.entryId, entry.id)),
    ctx.db.select().from(documentRequirements).where(eq(documentRequirements.shipmentId, entry.shipmentId)),
    ctx.db
      .select({ doc: documents, version: documentVersions })
      .from(documents)
      .leftJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion)))
      .where(and(eq(documents.shipmentId, entry.shipmentId), isNull(documents.deletedAt))),
    isBroker ? ctx.db.select().from(documentExtractions).where(eq(documentExtractions.orgId, ctx.org.id)).orderBy(desc(documentExtractions.createdAt)) : [],
    isBroker ? ctx.db.select().from(tasks).where(eq(tasks.customsEntryId, entry.id)).orderBy(asc(tasks.dueAt)) : [],
  ]);
  const docIds = new Set(docs.map((d) => d.doc.id));
  const ex = extractions.filter((e) => docIds.has(e.documentId));
  return {
    entry,
    shipment,
    isBroker,
    lines,
    requirements: reqs,
    documents: docs.map((d) => ({ ...d.doc, version: d.version })),
    extractions: ex,
    discrepancies: isBroker ? findDiscrepancies(ex, docs.map((d) => d.doc), shipment) : [],
    tasks: entryTasks,
    filingAdapters: FILING_ADAPTERS,
    insights: await entryInsights(ctx, entry),
  };
}

export async function updateCustomsEntry(ctx: Ctx, entryId: string, input: z.infer<typeof customsEntrySchema>) {
  requirePerm(ctx, "customs.manage");
  const [e] = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.id, entryId), eq(customsEntries.brokerOrgId, ctx.org.id)));
  if (!e) throw notFound("Customs file");
  await ctx.db
    .update(customsEntries)
    .set({ portOfEntry: input.portOfEntry ?? e.portOfEntry, arrivalAt: input.arrivalAt ?? e.arrivalAt, importerName: input.importerName ?? e.importerName, assignedToUserId: input.assignedToUserId ?? e.assignedToUserId, brokerNotes: input.brokerNotes ?? e.brokerNotes })
    .where(eq(customsEntries.id, e.id));
  await audit(ctx, "customs.entry_updated", "customs_entry", e.id, { before: e, after: input });
}

const CUSTOMS_TRANSITIONS: Record<string, string[]> = {
  INTAKE: ["DOCS_PENDING"],
  DOCS_PENDING: ["IN_REVIEW", "HOLD"],
  IN_REVIEW: ["DOCS_PENDING", "READY_TO_FILE", "HOLD"],
  READY_TO_FILE: ["IN_REVIEW", "HOLD"],
  SUBMITTED: ["RELEASED", "HOLD"],
  HOLD: ["IN_REVIEW", "RELEASED", "DOCS_PENDING"],
  RELEASED: ["CLOSED"],
  CLOSED: [],
};

export async function setCustomsStatus(ctx: Ctx, entryId: string, input: z.infer<typeof customsStatusSchema>) {
  requirePerm(ctx, "customs.manage");
  const [e] = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.id, entryId), eq(customsEntries.brokerOrgId, ctx.org.id)));
  if (!e) throw notFound("Customs file");
  if (!CUSTOMS_TRANSITIONS[e.status]?.includes(input.status)) throw new AppError("INVALID_TRANSITION", `Cannot move customs file from ${e.status} to ${input.status}`);
  // Marking ready to file and recording release are professional decisions reserved to licensed brokers.
  if (["READY_TO_FILE", "RELEASED"].includes(input.status)) requirePerm(ctx, "customs.approve");
  if (input.status === "READY_TO_FILE") {
    const lines = await ctx.db.select().from(customsLines).where(eq(customsLines.entryId, e.id));
    if (!lines.length || lines.some((l) => !l.brokerReviewed)) throw conflict("Every entry line must be reviewed by a licensed broker first");
    await assertReviewClear(ctx, e);
  }
  await ctx.db.update(customsEntries).set({ status: input.status }).where(eq(customsEntries.id, e.id));
  await recordEvent(ctx, e.shipmentId, {
    type: "CUSTOMS_STATUS",
    title: `Customs: ${input.status.replace(/_/g, " ").toLowerCase()}`,
    customerTracking: ["RELEASED", "HOLD"].includes(input.status),
    detail: { from: e.status, to: input.status },
  });
  if (input.status === "HOLD") {
    await openException(ctx, e.shipmentId, { type: "CUSTOMS_HOLD", severity: "HIGH", title: "Customs hold", description: "Placed on hold by the customs broker. See the customs file for details.", customerVisible: true, legId: null, vehicleId: null }, { customsEntryId: e.id });
  }
  await audit(ctx, "customs.status_changed", "customs_entry", e.id, { before: { status: e.status }, after: { status: input.status } });
}

export async function upsertCustomsLine(ctx: Ctx, entryId: string, input: z.infer<typeof customsLineSchema>, lineId?: string) {
  requirePerm(ctx, "customs.manage");
  const [e] = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.id, entryId), eq(customsEntries.brokerOrgId, ctx.org.id)));
  if (!e) throw notFound("Customs file");
  if (["SUBMITTED", "RELEASED", "CLOSED"].includes(e.status)) throw conflict("This entry is locked after submission");
  if (input.brokerReviewed) requirePerm(ctx, "customs.approve");
  const review = input.brokerReviewed ? { reviewedBy: ctx.user.id, reviewedAt: new Date() } : { reviewedBy: null, reviewedAt: null };
  if (lineId) {
    const res = await ctx.db.update(customsLines).set({ ...input, ...review }).where(and(eq(customsLines.id, lineId), eq(customsLines.entryId, e.id))).returning();
    if (!res.length) throw notFound("Line");
    await audit(ctx, "customs.line_updated", "customs_line", lineId, { after: input });
    return res[0];
  }
  const [{ max }] = await ctx.db.select({ max: sql<number>`coalesce(max(${customsLines.lineNumber}), 0)::int` }).from(customsLines).where(eq(customsLines.entryId, e.id));
  const [row] = await ctx.db.insert(customsLines).values({ entryId: e.id, lineNumber: max + 1, ...input, ...review }).returning();
  await audit(ctx, "customs.line_added", "customs_line", row.id, { after: input });
  return row;
}

export async function submitFiling(ctx: Ctx, entryId: string, adapterKey: string, confirm: boolean) {
  requirePerm(ctx, "customs.approve");
  if (!confirm) throw new AppError("VALIDATION_FAILED", "Explicit confirmation is required to submit a filing");
  const adapter = FILING_ADAPTERS.find((a) => a.key === adapterKey);
  if (!adapter) throw notFound("Filing adapter");
  if (!adapter.connected) throw new AppError("NOT_CONNECTED", `${adapter.name} is not connected. ${adapter.description}`);
  const [e] = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.id, entryId), eq(customsEntries.brokerOrgId, ctx.org.id)));
  if (!e) throw notFound("Customs file");
  if (e.status !== "READY_TO_FILE") throw conflict("Mark the file ready to file before submitting");
  const reference = `DEMO-${Date.now().toString(36).toUpperCase()}`;
  await ctx.db
    .update(customsEntries)
    .set({ status: "SUBMITTED", filingAdapter: adapter.key, filingReference: reference, filingSubmittedAt: new Date(), filingSubmittedBy: ctx.user.id })
    .where(eq(customsEntries.id, e.id));
  await recordEvent(ctx, e.shipmentId, { type: "CUSTOMS_FILED", title: `[Demonstration] Filing recorded (${reference}); nothing was sent to CBP`, detail: { adapter: adapter.key, reference } });
  await audit(ctx, "customs.filing_submitted", "customs_entry", e.id, { after: { adapter: adapter.key, reference, demonstration: adapter.demonstration } });
  return { reference, demonstration: adapter.demonstration };
}

/* ---------------------------------------------------------------- Tasks */

export async function createTask(ctx: Ctx, input: z.infer<typeof taskSchema>) {
  requirePerm(ctx, "shipment.read");
  if (input.shipmentId) await requireParty(ctx, input.shipmentId);
  const [t] = await ctx.db.insert(tasks).values({ orgId: ctx.org.id, ...input, createdBy: ctx.user.id }).returning();
  if (input.assigneeUserId && input.assigneeUserId !== ctx.user.id) {
    await enqueue(ctx.db, "notify.user", { userId: input.assigneeUserId, orgId: ctx.org.id, type: "TASK_ASSIGNED", title: `Task assigned: ${input.title}`, link: input.shipmentId ? `/shipments/${input.shipmentId}` : "/customs" });
  }
  return t;
}

export async function completeTask(ctx: Ctx, taskId: string) {
  const res = await ctx.db.update(tasks).set({ status: "DONE", completedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.orgId, ctx.org.id))).returning({ id: tasks.id });
  if (!res.length) throw notFound("Task");
  await audit(ctx, "task.completed", "task", taskId);
}

/* ---------------------------------------------------------------- AI-assisted extraction */

export async function requestExtraction(ctx: Ctx, documentId: string) {
  requirePerm(ctx, "customs.manage", "ai.use");
  const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || !doc.shipmentId) throw notFound("Document");
  const access = await requireParty(ctx, doc.shipmentId);
  if (!access.isCustomsBroker) throw new AppError("FORBIDDEN", "Extraction is available to the appointed customs broker");
  const [row] = await ctx.db.insert(documentExtractions).values({ documentId: doc.id, version: doc.currentVersion, orgId: ctx.org.id, engine: "queued" }).returning();
  await enqueue(ctx.db, "document.extract", { extractionId: row.id });
  return row;
}

export async function documentText(buf: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const { text } = await extractText(new Uint8Array(buf), { mergePages: false });
    return (Array.isArray(text) ? text : [text]).join("\f");
  }
  if (mimeType.startsWith("text/")) return buf.toString("utf8");
  return "";
}

/** Job handler (system context): read the file, run the engine, store a draft awaiting human review. */
export async function runExtraction(db: DB, extractionId: string) {
  const [ex] = await db.select().from(documentExtractions).where(eq(documentExtractions.id, extractionId));
  if (!ex || ex.status !== "PENDING") return;
  const [doc] = await db.select().from(documents).where(eq(documents.id, ex.documentId));
  const [ver] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, ex.documentId), eq(documentVersions.version, ex.version)));
  if (!doc || !ver) return;
  try {
    const text = await documentText(await storage().get(ver.storageKey), ver.mimeType);
    const result = await extractFields(text, doc.category);
    const items = doc.category === "COMMERCIAL_INVOICE" ? await extractLineItems(text) : { items: [], warnings: [] as string[] };
    await db.update(documentExtractions).set({ status: "COMPLETED", engine: result.engine, fields: result.fields, lineItems: items.items, warnings: [...result.warnings, ...items.warnings] }).where(eq(documentExtractions.id, ex.id));
  } catch (err) {
    await db.update(documentExtractions).set({ status: "FAILED", error: String((err as Error).message ?? err).slice(0, 500) }).where(eq(documentExtractions.id, ex.id));
  }
}

/**
 * Human review gate. Nothing extracted becomes authoritative until a person approves it here.
 * Applying values to the customs entry additionally requires the licensed-broker permission.
 */
export async function reviewExtraction(ctx: Ctx, extractionId: string, input: z.infer<typeof extractionReviewSchema>) {
  requirePerm(ctx, "customs.manage");
  const [ex] = await ctx.db.select().from(documentExtractions).where(eq(documentExtractions.id, extractionId));
  if (!ex) throw notFound("Extraction");
  if (ex.status !== "COMPLETED") throw conflict("Extraction has not completed");
  if (ex.reviewStatus !== "PENDING_REVIEW") throw conflict("Extraction has already been reviewed");
  const known = new Set(ex.fields.map((f) => f.key));
  const unknown = Object.keys(input.fields).filter((k) => !known.has(k) && !FIELD_DEFS[k]);
  if (unknown.length) throw new AppError("VALIDATION_FAILED", `Unknown fields: ${unknown.join(", ")}`);
  await ctx.db
    .update(documentExtractions)
    .set({ reviewStatus: input.decision, approvedFields: input.decision === "APPROVED" ? input.fields : null, reviewedBy: ctx.user.id, reviewedAt: new Date() })
    .where(eq(documentExtractions.id, ex.id));

  if (input.decision === "APPROVED" && input.applyToEntry) {
    requirePerm(ctx, "customs.approve");
    const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, ex.documentId));
    const [entry] = await ctx.db.select().from(customsEntries).where(and(eq(customsEntries.shipmentId, doc.shipmentId!), eq(customsEntries.brokerOrgId, ctx.org.id)));
    if (!entry) throw conflict("Open a customs file before applying values");
    const patch: Partial<typeof customsEntries.$inferInsert> = {};
    const f = input.fields;
    if (f.total_value) {
      const cur = (f.currency ?? entry.currency ?? "USD").toUpperCase();
      if (!["USD", "CAD", "MXN", "EUR"].includes(cur)) throw new AppError("VALIDATION_FAILED", `Currency ${cur} is not supported for declared value; record it in notes`);
      patch.declaredValueMinor = parseToMinor(f.total_value, cur as "USD");
      patch.currency = cur;
    }
    if (f.country_of_origin) patch.countryOfOrigin = f.country_of_origin.slice(0, 60);
    if (f.gross_weight_kg) patch.grossWeightKg = Math.round(Number(f.gross_weight_kg.replace(/,/g, "")));
    if (f.buyer && !entry.importerName) patch.importerName = f.buyer.slice(0, 160);
    await ctx.db.update(customsEntries).set(patch).where(eq(customsEntries.id, entry.id));
    await recordEvent(ctx, doc.shipmentId!, { type: "EXTRACTION_APPLIED", title: `Approved values from ${categoryLabel(doc.category)} applied to customs file`, internal: true, detail: { extractionId: ex.id, fields: Object.keys(patch) } });
    await audit(ctx, "customs.extraction_applied", "customs_entry", entry.id, { before: { declaredValueMinor: entry.declaredValueMinor, countryOfOrigin: entry.countryOfOrigin }, after: patch });
  }
  await audit(ctx, `extraction.${input.decision.toLowerCase()}`, "document_extraction", ex.id, { after: { fields: input.fields } });
}

/* ---------------------------------------------------------------- Discrepancy review */

export interface Discrepancy {
  field: string;
  label: string;
  severity: "warning" | "info";
  values: { value: string; source: string; documentId?: string; snippet?: string }[];
  explanation: string;
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]/g, "");
const num = (v: string) => Number(v.replace(/[^0-9.]/g, ""));

/** Compare values across documents (latest extraction per document; approved values win) and the shipment record. */
export function findDiscrepancies(
  extractions: (typeof documentExtractions.$inferSelect)[],
  docs: (typeof documents.$inferSelect)[],
  shipment: { containerNumber: string | null; countryOfOrigin: string | null; billOfLadingNumber: string | null } | undefined,
): Discrepancy[] {
  const latest = new Map<string, typeof documentExtractions.$inferSelect>();
  for (const e of extractions) if (e.status === "COMPLETED" && e.reviewStatus !== "REJECTED" && !latest.has(e.documentId)) latest.set(e.documentId, e);
  const byField = new Map<string, Discrepancy["values"]>();
  for (const [docId, e] of latest) {
    const doc = docs.find((d) => d.id === docId);
    const source = doc ? categoryLabel(doc.category) : "Document";
    const values: Record<string, { value: string; snippet?: string }> = {};
    for (const f of e.fields as ExtractedField[]) values[f.key] = { value: f.value, snippet: f.source.snippet };
    for (const [k, v] of Object.entries(e.approvedFields ?? {})) values[k] = { value: v, snippet: values[k]?.snippet };
    for (const [k, v] of Object.entries(values)) {
      const list = byField.get(k) ?? [];
      list.push({ value: v.value, source: `${source}${e.reviewStatus === "APPROVED" ? " (approved)" : " (unreviewed)"}`, documentId: docId, snippet: v.snippet });
      byField.set(k, list);
    }
  }
  if (shipment?.containerNumber) push("container_number", shipment.containerNumber);
  if (shipment?.billOfLadingNumber) push("bill_of_lading_number", shipment.billOfLadingNumber);
  function push(k: string, v: string) {
    const list = byField.get(k);
    if (list) list.push({ value: v, source: "Shipment record" });
  }

  const out: Discrepancy[] = [];
  for (const [field, values] of byField) {
    if (values.length < 2) continue;
    const numeric = ["total_value", "gross_weight_kg", "total_packages"].includes(field);
    let differs: boolean;
    if (numeric) {
      const nums = values.map((v) => num(v.value)).filter((n) => Number.isFinite(n));
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      differs = max - min > (field === "gross_weight_kg" ? max * 0.02 : 0);
    } else {
      differs = new Set(values.map((v) => norm(v.value))).size > 1;
    }
    if (!differs) continue;
    out.push({
      field,
      label: FIELD_DEFS[field]?.label ?? field,
      severity: ["total_value", "container_number", "country_of_origin", "total_packages"].includes(field) ? "warning" : "info",
      values,
      explanation: numeric && field === "gross_weight_kg" ? "Gross weights differ by more than 2% across sources." : "Sources disagree. Confirm with the importer before relying on either value.",
    });
  }
  return out;
}
