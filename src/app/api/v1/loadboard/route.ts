import { authed } from "@/server/http/api";
import { loadBoard } from "@/server/services/quotes";

export const GET = authed(({ ctx }) => loadBoard(ctx));
