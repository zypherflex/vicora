import { sessionOnly } from "@/server/http/api";

export const GET = sessionOnly(async ({ auth }) => ({
  user: auth.user,
  activeOrgId: auth.active?.orgId ?? null,
  memberships: auth.memberships.map((m) => ({ orgId: m.orgId, orgName: m.orgName, orgType: m.orgType, roles: m.roles, permissions: [...m.permissions] })),
}));
