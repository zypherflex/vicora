import { authed } from "@/server/http/api";
import { revokeTrackingLink } from "@/server/services/tracking";

export const DELETE = authed(({ ctx, params }) => revokeTrackingLink(ctx, params.id));
