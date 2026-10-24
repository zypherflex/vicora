import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { categoryLabel, DOCUMENT_CATEGORIES } from "@/lib/domain";
import { storage, validateUpload } from "@/server/adapters/storage";
import { hmac, safeEqual, sha256Hex } from "@/server/auth/crypto";
import { requirePerm, type Ctx } from "@/server/authz/context";
import type { DB } from "@/server/db/client";
import { documentExtractions, documentRequirements, documents, documentVersions, organizations, shipments } from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type { documentMetaSchema, documentRequirementSchema } from "@/server/validators";
import { audit, enqueue, recordEvent, requireParty } from "./common";

export interface UploadInput {
  shipmentId?: string | null;
  /** Organization-level document (insurance, authority). Always the caller's own org. */
  orgLevel?: boolean;
  filename: string;
  data: Buffer;
  meta: z.infer<typeof documentMetaSchema>;
}

export async function uploadDocument(ctx: Ctx, input: UploadInput) {
  requirePerm(ctx, "document.upload");
  const { mimeType, filename } = validateUpload(input.filename, input.data);
  let shipmentRef: string | null = null;
  let isCustomer = false;
  if (input.shipmentId) {
    const access = await requireParty(ctx, input.shipmentId);
    shipmentRef = access.shipment.reference;
    isCustomer = access.isCustomer;
  } else if (!input.orgLevel) {
    throw new AppError("VALIDATION_FAILED", "Documents must belong to a shipment or to your organization");
  }

  const [org] = await ctx.db.select({ days: organizations.documentRetentionDays }).from(organizations).where(eq(organizations.id, ctx.org.id));
  const retentionUntil = new Date(Date.now() + (org?.days ?? 2555) * 86400_000);
  const sha = sha256Hex(input.data);

  let doc: typeof documents.$inferSelect;
  let version = 1;
  if (input.meta.documentId) {
    const [existing] = await ctx.db.select().from(documents).where(eq(documents.id, input.meta.documentId));
    if (!existing || existing.deletedAt) throw notFound("Document");
    if (existing.ownerOrgId !== ctx.org.id) throw new AppError("FORBIDDEN", "Only the uploading organization can add versions");
    version = existing.currentVersion + 1;
    [doc] = await ctx.db.update(documents).set({ currentVersion: version, status: "UPLOADED", retentionUntil }).where(eq(documents.id, existing.id)).returning();
  } else {
    [doc] = await ctx.db
      .insert(documents)
      .values({
        ownerOrgId: ctx.org.id,
        shipmentId: input.shipmentId ?? null,
        subjectOrgId: input.orgLevel ? ctx.org.id : null,
        category: input.meta.category,
        title: input.meta.title ?? `${categoryLabel(input.meta.category)} — ${filename}`,
        visibility: input.meta.visibility,
        // Documents uploaded by the customer are always visible to the customer.
        customerVisible: isCustomer ? true : input.meta.customerVisible,
        retentionUntil,
        createdBy: ctx.user.id,
      })
      .returning();
  }

  const storageKey = `${ctx.org.id}/${new Date().toISOString().slice(0, 7)}/${doc.id}-v${version}`;
  await storage().put(storageKey, input.data, mimeType);
  const [ver] = await ctx.db
    .insert(documentVersions)
    .values({ documentId: doc.id, version, storageKey, filename, mimeType, sizeBytes: input.data.length, sha256: sha, uploadedBy: ctx.user.id })
    .returning();

  if (input.shipmentId) {
    await ctx.db
      .update(documentRequirements)
      .set({ status: "RECEIVED", documentId: doc.id })
      .where(and(eq(documentRequirements.shipmentId, input.shipmentId), eq(documentRequirements.category, doc.category), eq(documentRequirements.status, "REQUESTED")));
    await recordEvent(ctx, input.shipmentId, {
      type: "DOCUMENT_UPLOADED",
      title: `${categoryLabel(doc.category)} uploaded${version > 1 ? ` (v${version})` : ""}`,
      detail: { documentId: doc.id, version, filename },
      internal: doc.visibility === "INTERNAL",
      customerTracking: doc.category === "PROOF_OF_DELIVERY" && doc.customerVisible,
    });
  }
  await audit(ctx, version > 1 ? "document.version_added" : "document.uploaded", "document", doc.id, {
    after: { version, sha256: sha, sizeBytes: input.data.length, shipment: shipmentRef },
  });
  return { document: doc, version: ver };
}

export async function getDocument(ctx: Ctx, documentId: string) {
  requirePerm(ctx, "document.read");
  const [doc] = await ctx.db.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!doc) throw notFound("Document");
  const versions = await ctx.db.select().from(documentVersions).where(eq(documentVersions.documentId, doc.id)).orderBy(desc(documentVersions.version));
  const extractions = await ctx.db.select().from(documentExtractions).where(eq(documentExtractions.documentId, doc.id)).orderBy(desc(documentExtractions.createdAt));
  return { doc, versions, extractions };
}

export async function listDocuments(ctx: Ctx, filter: { category?: string; shipmentId?: string } = {}) {
  requirePerm(ctx, "document.read");
  const where = [isNull(documents.deletedAt)];
  if (filter.category) where.push(eq(documents.category, filter.category));
  if (filter.shipmentId) where.push(eq(documents.shipmentId, filter.shipmentId));
  const rows = await ctx.db
    .select({ doc: documents, version: documentVersions, reference: shipments.reference })
    .from(documents)
    .leftJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion)))
    .leftJoin(shipments, eq(shipments.id, documents.shipmentId))
    .where(and(...where))
    .orderBy(desc(documents.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r.doc, version: r.version, shipmentReference: r.reference }));
}

export async function reviewDocument(ctx: Ctx, documentId: string, status: "APPROVED" | "REJECTED") {
  requirePerm(ctx, "document.review");
  const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw notFound("Document");
  if (doc.shipmentId) {
    const access = await requireParty(ctx, doc.shipmentId);
    if (access.isCustomer && doc.ownerOrgId !== ctx.org.id) throw new AppError("FORBIDDEN", "Customers cannot review provider documents");
  } else if (doc.ownerOrgId !== ctx.org.id) {
    throw new AppError("FORBIDDEN", "Organization documents are reviewed through compliance verification");
  }
  await ctx.db.update(documents).set({ status }).where(eq(documents.id, documentId));
  if (doc.shipmentId) {
    await ctx.db
      .update(documentRequirements)
      .set({ status: status === "APPROVED" ? "APPROVED" : "REQUESTED" })
      .where(and(eq(documentRequirements.documentId, doc.id)));
    await recordEvent(ctx, doc.shipmentId, { type: "DOCUMENT_REVIEWED", title: `${categoryLabel(doc.category)} ${status.toLowerCase()}`, detail: { documentId: doc.id } });
  }
  await audit(ctx, "document.reviewed", "document", doc.id, { before: { status: doc.status }, after: { status } });
}

export async function requestDocument(ctx: Ctx, shipmentId: string, input: z.infer<typeof documentRequirementSchema>) {
  requirePerm(ctx, "document.review");
  const access = await requireParty(ctx, shipmentId);
  const [existing] = await ctx.db
    .select()
    .from(documentRequirements)
    .where(and(eq(documentRequirements.shipmentId, shipmentId), eq(documentRequirements.category, input.category), inArray(documentRequirements.status, ["REQUESTED", "RECEIVED"])));
  if (existing) throw conflict(`${categoryLabel(input.category)} has already been requested`);
  const [req] = await ctx.db
    .insert(documentRequirements)
    .values({ shipmentId, requestedByOrgId: ctx.org.id, category: input.category, dueAt: input.dueAt ?? null, note: input.note })
    .returning();
  await recordEvent(ctx, shipmentId, {
    type: "DOCUMENT_REQUESTED",
    title: `${ctx.org.name} requested: ${categoryLabel(input.category)}`,
    detail: { requirementId: req.id, dueAt: input.dueAt ?? null },
  });
  await enqueue(ctx.db, "notify.org", {
    orgId: access.shipment.ownerOrgId,
    type: "DOCUMENT_REQUESTED",
    title: `Document needed for ${access.shipment.reference}`,
    body: `${ctx.org.name} requested a ${categoryLabel(input.category).toLowerCase()}.`,
    link: `/shipments/${shipmentId}?tab=documents`,
    shipmentId,
  });
  return req;
}

/* ---------------------------------------------------------------- Signed downloads */

const LINK_TTL_SECONDS = 300;

/** Issue a short-lived link bound to the requesting user. RLS must already allow the caller to see the version. */
export async function signedDownloadUrl(ctx: Ctx, versionId: string) {
  requirePerm(ctx, "document.read");
  const [v] = await ctx.db.select({ id: documentVersions.id, purgedAt: documentVersions.purgedAt }).from(documentVersions).where(eq(documentVersions.id, versionId));
  if (!v) throw notFound("Document");
  if (v.purgedAt) throw new AppError("NOT_FOUND", "This file was removed under the retention policy");
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
  const sig = hmac(`dl:${versionId}:${exp}:${ctx.user.id}`);
  return `/api/v1/files/${versionId}?exp=${exp}&sig=${sig}`;
}

export function verifyDownloadSignature(versionId: string, exp: string | null, sig: string | null, userId: string) {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(hmac(`dl:${versionId}:${exp}:${userId}`), sig);
}

export async function readVersionForDownload(ctx: Ctx, versionId: string) {
  const [v] = await ctx.db.select().from(documentVersions).where(eq(documentVersions.id, versionId));
  if (!v || v.purgedAt) throw notFound("Document");
  const data = await storage().get(v.storageKey);
  await audit(ctx, "document.downloaded", "document_version", v.id);
  return { version: v, data };
}

/* ---------------------------------------------------------------- Retention (system job) */

export async function purgeExpiredDocuments(db: DB, now = new Date()) {
  const expired = await db
    .select({ doc: documents, version: documentVersions })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(and(lt(documents.retentionUntil, now), isNull(documentVersions.purgedAt)))
    .limit(500);
  for (const row of expired) {
    await storage().delete(row.version.storageKey);
    await db.update(documentVersions).set({ purgedAt: now }).where(eq(documentVersions.id, row.version.id));
    await db.update(documents).set({ deletedAt: now }).where(eq(documents.id, row.doc.id));
  }
  if (expired.length) {
    await db.execute(sql`insert into audit_log (action, entity_type, after) values ('document.retention_purge', 'document', ${JSON.stringify({ count: expired.length })}::jsonb)`);
  }
  return expired.length;
}

export const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES;
