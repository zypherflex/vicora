import type { NextRequest } from "next/server";
import { env } from "@/server/env";
import { documentMetaSchema } from "@/server/validators";
import { AppError } from "./errors";

/** Parse a multipart upload: one "file" field plus metadata fields. Size is checked before buffering. */
export async function readUpload(req: NextRequest) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > env().MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "File is too large");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("BAD_REQUEST", "Expected multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "Attach a file in the \"file\" field");
  const meta = documentMetaSchema.parse({
    category: form.get("category"),
    title: form.get("title") || null,
    visibility: form.get("visibility") || "SHARED",
    customerVisible: form.get("customerVisible") === null ? true : form.get("customerVisible") === "true",
    documentId: form.get("documentId") || null,
  });
  return { filename: file.name, data: Buffer.from(await file.arrayBuffer()), meta };
}
