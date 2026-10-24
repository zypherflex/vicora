import { z } from "zod";
import { body, sessionOnly } from "@/server/http/api";
import { setOrgStatus } from "@/server/services/platform";

export const PATCH = sessionOnly(async ({ req, auth, params }) => setOrgStatus(auth, params.id, (await body(req, z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }))).status));
