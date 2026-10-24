import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/env";
import { AppError } from "@/server/http/errors";

/**
 * Private object storage. Files are never served from a public path: downloads go through
 * an authorization check and a short-lived HMAC-signed URL (see services/documents.ts).
 */
export interface StorageAdapter {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements StorageAdapter {
  readonly name = "local-private-disk";
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new AppError("BAD_REQUEST", "Invalid storage key");
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new AppError("BAD_REQUEST", "Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

class S3NotConnected implements StorageAdapter {
  readonly name = "s3 (not connected)";
  private fail(): never {
    throw new AppError(
      "NOT_CONNECTED",
      "S3 storage is not connected. Implement the S3 adapter with a private bucket (Block Public Access on, SSE-KMS) and set STORAGE_DRIVER=s3.",
    );
  }
  async put() {
    this.fail();
  }
  async get(): Promise<Buffer> {
    this.fail();
  }
  async delete() {
    this.fail();
  }
}

let instance: StorageAdapter | undefined;
export function storage(): StorageAdapter {
  if (!instance) instance = env().STORAGE_DRIVER === "s3" ? new S3NotConnected() : new LocalStorage(path.resolve(env().STORAGE_LOCAL_DIR));
  return instance;
}

/* ---------------------------------------------------------------- File validation */

export const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
};

/** Detect the real content type from magic bytes. The client-declared type is never trusted. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.subarray(4, 12).toString("latin1").match(/^ftyp(heic|heix|mif1)/)) return "image/heic";
  // Text: valid UTF-8 without NUL bytes.
  if (!buf.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, 65536));
      return "text/plain";
    } catch {
      return null;
    }
  }
  return null;
}

export function validateUpload(filename: string, buf: Buffer): { mimeType: string; filename: string } {
  if (buf.length === 0) throw new AppError("VALIDATION_FAILED", "The file is empty");
  if (buf.length > env().MAX_UPLOAD_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", `Files must be under ${Math.round(env().MAX_UPLOAD_BYTES / 1048576)} MB`);
  const clean = filename.normalize("NFKC").replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").slice(-120) || "upload";
  const ext = path.extname(clean).toLowerCase();
  let mime = sniffMime(buf);
  if (mime === "text/plain" && ext === ".csv") mime = "text/csv";
  if (!mime || !ALLOWED_TYPES[mime]) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Allowed file types: PDF, PNG, JPEG, WebP, HEIC, TXT, CSV");
  if (!ALLOWED_TYPES[mime].includes(ext)) throw new AppError("UNSUPPORTED_MEDIA_TYPE", `File extension ${ext || "(none)"} does not match its contents (${mime})`);
  return { mimeType: mime, filename: clean };
}
