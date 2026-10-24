import { authed } from "@/server/http/api";
import { readUpload } from "@/server/http/upload";
import { listDocuments, uploadDocument } from "@/server/services/documents";

export const GET = authed(({ ctx }) => listDocuments(ctx));
export const POST = authed(async ({ req, ctx }) => {
  const up = await readUpload(req);
  const r = await uploadDocument(ctx, { orgLevel: true, ...up });
  return { documentId: r.document.id, versionId: r.version.id };
}, { rateLimit: { key: "upload", limit: 120, windowSeconds: 3600 } });
