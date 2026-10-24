import { authed } from "@/server/http/api";
import { attentionFor } from "@/server/services/attention";

export const GET = authed(({ ctx }) => attentionFor(ctx));
