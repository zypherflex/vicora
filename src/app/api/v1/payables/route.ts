import { authed } from "@/server/http/api";
import { listPayables } from "@/server/services/finance";

export const GET = authed(({ ctx }) => listPayables(ctx));
