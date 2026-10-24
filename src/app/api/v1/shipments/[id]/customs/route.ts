import { authed, body } from "@/server/http/api";
import { openCustomsEntry } from "@/server/services/customs";
import { customsEntrySchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => openCustomsEntry(ctx, params.id, await body(req, customsEntrySchema)));
