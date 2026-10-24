import { authed } from "@/server/http/api";
import { readUpload } from "@/server/http/upload";
import { listDocuments, uploadDocument } from "@/server/services/documents";

export const GET = authed(({ ctx, params }) => listDocuments(ctx, { shipmentId: params.id }));
export const POST = authed(async ({ req, ctx, params }) => {
  const up = await readUpload(req);
  const r = await uploadDocument(ctx, { shipmentId: params.id, ...up });
  return { documentId: r.document.id, versionId: r.version.id, version: r.version.version };
}, { rateLimit: { key: "upload", limit: 120, windowSeconds: 3600 } });
