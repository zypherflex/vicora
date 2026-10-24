import { authed } from "@/server/http/api";
import { listMembers } from "@/server/services/orgs";

export const GET = authed(({ ctx }) => listMembers(ctx));
