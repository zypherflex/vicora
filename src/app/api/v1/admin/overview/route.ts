import { sessionOnly } from "@/server/http/api";
import { platformOverview } from "@/server/services/platform";

export const GET = sessionOnly(({ auth }) => platformOverview(auth));
