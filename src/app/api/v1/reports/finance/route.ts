import { authed } from "@/server/http/api";
import { financeReport } from "@/server/services/finance";

export const GET = authed(({ ctx }) => financeReport(ctx));
