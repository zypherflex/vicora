import { authed } from "@/server/http/api";
import { revokeInvitation } from "@/server/services/orgs";

export const DELETE = authed(({ ctx, params }) => revokeInvitation(ctx, params.id));
