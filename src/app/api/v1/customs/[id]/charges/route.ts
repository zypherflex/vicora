import { authed } from "@/server/http/api";
import { generateBrokerageCharges } from "@/server/services/brokerage";

export const POST = authed(({ ctx, params }) => generateBrokerageCharges(ctx, params.id));
