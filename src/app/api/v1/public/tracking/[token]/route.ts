import { publicRoute } from "@/server/http/api";
import { notFound } from "@/server/http/errors";
import { publicTracking } from "@/server/services/tracking";

export const GET = publicRoute(
  async ({ params }) => {
    const t = await publicTracking(params.token);
    if (!t) throw notFound("Tracking link");
    return t;
  },
  { rateLimit: { key: "public-tracking", limit: 120, windowSeconds: 600 } },
);
