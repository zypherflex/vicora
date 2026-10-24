import { authed, body } from "@/server/http/api";
import { updateDeadlineRule } from "@/server/services/brokerage";
import { deadlineRuleSchema } from "@/server/validators";

export const PATCH = authed(async ({ req, ctx, params }) => updateDeadlineRule(ctx, params.ruleId, await body(req, deadlineRuleSchema)));
