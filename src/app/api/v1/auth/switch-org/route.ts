import { setActiveOrg } from "@/server/auth/session";
import { body, sessionOnly } from "@/server/http/api";
import { forbidden } from "@/server/http/errors";
import { switchOrgSchema } from "@/server/validators";

export const POST = sessionOnly(async ({ req, auth }) => {
  const { orgId } = await body(req, switchOrgSchema);
  if (!auth.memberships.some((m) => m.orgId === orgId)) throw forbidden("You are not a member of that organization");
  await setActiveOrg(auth.sessionId, orgId);
  return { activeOrgId: orgId };
});
