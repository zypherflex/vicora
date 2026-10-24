import { authed, body } from "@/server/http/api";
import { saveLineToLibrary } from "@/server/services/brokerage";
import { saveToLibrarySchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => saveLineToLibrary(ctx, params.id, params.lineId, (await body(req, saveToLibrarySchema)).rationale ?? null));
