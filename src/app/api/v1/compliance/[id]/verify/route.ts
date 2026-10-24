import { authed, body } from "@/server/http/api";
import { verifyComplianceRecord } from "@/server/services/compliance";
import { verifyComplianceSchema } from "@/server/validators";

export const POST = authed(async ({ req, ctx, params }) => verifyComplianceRecord(ctx, params.id, await body(req, verifyComplianceSchema)));
