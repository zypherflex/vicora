import { authed } from "@/server/http/api";
import { getDocument } from "@/server/services/documents";

export const GET = authed(({ ctx, params }) => getDocument(ctx, params.id));
