import { authed, body } from "@/server/http/api";
import { recordLegMilestone } from "@/server/services/operations";
import { legMilestoneSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => recordLegMilestone(ctx, params.id, params.legId, await body(req, legMilestoneSchema)));
