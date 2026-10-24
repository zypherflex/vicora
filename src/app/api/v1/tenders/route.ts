import { authed } from "@/server/http/api";
import { listTenders } from "@/server/services/operations";

export const GET = authed(({ ctx }) => listTenders(ctx));
