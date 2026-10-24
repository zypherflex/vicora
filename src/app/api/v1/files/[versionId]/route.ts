import { authed } from "@/server/http/api";
import { AppError } from "@/server/http/errors";
import { readVersionForDownload, verifyDownloadSignature } from "@/server/services/documents";

/**
 * Signed, user-bound, short-lived download. The signature alone is not enough: the request must also
 * carry the same user's session and row-level security must still allow the file.
 */
export const GET = authed(async ({ req, ctx, params }) => {
  const sp = req.nextUrl.searchParams;
  if (!verifyDownloadSignature(params.versionId, sp.get("exp"), sp.get("sig"), ctx.user.id)) throw new AppError("FORBIDDEN", "This download link is invalid or has expired");
  const { version, data } = await readVersionForDownload(ctx, params.versionId);
  const inline = sp.get("inline") === "1" && (version.mimeType.startsWith("image/") || version.mimeType === "application/pdf");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": version.mimeType,
      "content-length": String(data.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${version.filename.replace(/"/g, "")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
