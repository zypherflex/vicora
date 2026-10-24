import { authed, body } from "@/server/http/api";
import { addCreditNote } from "@/server/services/finance";
import { creditNoteSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => addCreditNote(ctx, params.id, await body(req, creditNoteSchema)));
