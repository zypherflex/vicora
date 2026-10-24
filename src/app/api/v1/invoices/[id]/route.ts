import { authed } from "@/server/http/api";
import { getInvoice } from "@/server/services/finance";

export const GET = authed(({ ctx, params }) => getInvoice(ctx, params.id));
