import { authed, body } from "@/server/http/api";
import { updateEntryDetails } from "@/server/services/brokerage";
import { entryDetailsSchema } from "@/server/validators";

export const PATCH = authed(async ({ req, ctx, params }) => updateEntryDetails(ctx, params.id, await body(req, entryDetailsSchema)));
