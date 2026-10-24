import { authed, body } from "@/server/http/api";
import { createSavedView, listSavedViews } from "@/server/services/comms";
import { savedViewSchema } from "@/server/validators";

export const GET = authed(({ ctx }) => listSavedViews(ctx));
export const POST = authed(async ({ req, ctx }) => createSavedView(ctx, await body(req, savedViewSchema)));
