import { authed } from "@/server/http/api";
import { customsWorkspace } from "@/server/services/customs";

export const GET = authed(({ ctx }) => customsWorkspace(ctx));
