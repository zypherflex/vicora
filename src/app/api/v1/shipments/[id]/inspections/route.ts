import { authed, body } from "@/server/http/api";
import { recordInspection } from "@/server/services/fleet";
import { inspectionSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => recordInspection(ctx, params.id, await body(req, inspectionSchema)));
