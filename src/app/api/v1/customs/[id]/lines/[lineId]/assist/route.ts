import { authed } from "@/server/http/api";
import { classificationAssist } from "@/server/services/brokerage";

export const POST = authed(({ ctx, params }) => classificationAssist(ctx, params.id, params.lineId));
