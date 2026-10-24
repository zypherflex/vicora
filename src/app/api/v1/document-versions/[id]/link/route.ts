import { authed } from "@/server/http/api";
import { signedDownloadUrl } from "@/server/services/documents";

export const GET = authed(async ({ ctx, params }) => ({ url: await signedDownloadUrl(ctx, params.id), expiresInSeconds: 300 }));
