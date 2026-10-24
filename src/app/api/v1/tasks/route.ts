import { authed, body } from "@/server/http/api";
import { createTask } from "@/server/services/customs";
import { taskSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx }) => createTask(ctx, await body(req, taskSchema)));
