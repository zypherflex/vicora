import { authed } from "@/server/http/api";
import { listDeadlineRules } from "@/server/services/brokerage";

export const GET = authed(({ ctx }) => listDeadlineRules(ctx));
