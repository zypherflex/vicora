import { authed, body } from "@/server/http/api";
import { createInvoice, listInvoices } from "@/server/services/finance";
import { createInvoiceSchema } from "@/server/validators";

export const GET = authed(({ ctx }) => listInvoices(ctx));
export const POST = authed(async ({ req, ctx }) => createInvoice(ctx, await body(req, createInvoiceSchema)));
