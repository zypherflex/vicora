import { authed } from "@/server/http/api";
import { listNotifications } from "@/server/services/comms";

export const GET = authed(({ ctx }) => listNotifications(ctx));
