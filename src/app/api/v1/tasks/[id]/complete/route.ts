import { authed } from "@/server/http/api";
import { completeTask } from "@/server/services/customs";

export const POST = authed(({ ctx, params }) => completeTask(ctx, params.id));
