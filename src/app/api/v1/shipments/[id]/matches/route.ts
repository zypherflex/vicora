import { authed } from "@/server/http/api";
import { matchProviders } from "@/server/services/compliance";

export const GET = authed(({ req, ctx, params }) => matchProviders(ctx, params.id, req.nextUrl.searchParams.get("purpose") === "invite" ? "invite" : "tender"));
