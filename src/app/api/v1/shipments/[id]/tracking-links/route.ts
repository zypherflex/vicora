import { authed, body } from "@/server/http/api";
import { createTrackingLink } from "@/server/services/tracking";
import { trackingLinkSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => createTrackingLink(ctx, params.id, await body(req, trackingLinkSchema)));
