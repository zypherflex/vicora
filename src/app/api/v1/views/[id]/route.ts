import { authed } from "@/server/http/api";
import { deleteSavedView } from "@/server/services/comms";

export const DELETE = authed(({ ctx, params }) => deleteSavedView(ctx, params.id));
