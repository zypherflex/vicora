import { authed } from "@/server/http/api";
import { listAudit } from "@/server/services/comms";

export const GET = authed(({ req, ctx }) => listAudit(ctx, { entityId: req.nextUrl.searchParams.get("entityId") ?? undefined }));
