import { authed, body } from "@/server/http/api";
import { setDeadlineStatus } from "@/server/services/brokerage";
import { deadlineStatusSchema } from "@/server/validators";

export const PATCH = authed(async ({ req, ctx, params }) => setDeadlineStatus(ctx, params.deadlineId, await body(req, deadlineStatusSchema)));
