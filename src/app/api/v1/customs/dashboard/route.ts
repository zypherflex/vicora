import { authed } from "@/server/http/api";
import { brokerDashboard } from "@/server/services/brokerage";

export const GET = authed(({ ctx }) => brokerDashboard(ctx));
