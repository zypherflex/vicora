import { authed } from "@/server/http/api";
import { providerDirectory } from "@/server/services/compliance";

export const GET = authed(({ ctx }) => providerDirectory(ctx));
