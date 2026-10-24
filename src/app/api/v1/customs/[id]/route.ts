import { authed, body } from "@/server/http/api";
import { getCustomsFile, updateCustomsEntry } from "@/server/services/customs";
import { customsEntrySchema } from "@/server/validators";

export const GET = authed(({ ctx, params }) => getCustomsFile(ctx, params.id));
export const PATCH = authed(async ({ req, ctx, params }) => updateCustomsEntry(ctx, params.id, await body(req, customsEntrySchema)));
