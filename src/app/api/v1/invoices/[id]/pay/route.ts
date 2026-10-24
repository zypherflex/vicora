import { authed, body } from "@/server/http/api";
import { payInvoice } from "@/server/services/finance";
import { payInvoiceSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => payInvoice(ctx, params.id, await body(req, payInvoiceSchema)), { rateLimit: { key: "pay", limit: 30, windowSeconds: 3600 } });
