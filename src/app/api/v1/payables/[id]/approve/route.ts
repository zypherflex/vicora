import { authed } from "@/server/http/api";
import { approvePayable } from "@/server/services/finance";

export const POST = authed(({ ctx, params }) => approvePayable(ctx, params.id));
