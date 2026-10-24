import { authed, body } from "@/server/http/api";
import { addComplianceRecord, listComplianceFor } from "@/server/services/compliance";
import { complianceRecordSchema } from "@/server/validators";

export const GET = authed(({ ctx }) => listComplianceFor(ctx, ctx.org.id));
export const POST = authed(async ({ req, ctx }) => addComplianceRecord(ctx, await body(req, complianceRecordSchema)));
