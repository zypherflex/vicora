import type { OrgType } from "@/lib/domain";
import type { Permission } from "@/lib/permissions";
import type { AuthState } from "@/server/auth/session";
import { withTenantTx, type Tx } from "@/server/db/client";
import { AppError, forbidden } from "@/server/http/errors";

/** Everything a service needs to act on behalf of a user within one organization. */
export interface Ctx {
  db: Tx;
  requestId: string;
  ip?: string;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean; timezone: string };
  org: { id: string; name: string; type: OrgType; timezone: string; currency: string; isDemo: boolean };
  roles: string[];
  perms: Set<Permission>;
}

export function can(ctx: Pick<Ctx, "perms">, p: Permission): boolean {
  return ctx.perms.has(p);
}

export function requirePerm(ctx: Pick<Ctx, "perms">, ...ps: Permission[]) {
  for (const p of ps) if (!ctx.perms.has(p)) throw forbidden(`Missing permission: ${p}`);
}

export function requireAnyPerm(ctx: Pick<Ctx, "perms">, ...ps: Permission[]) {
  if (!ps.some((p) => ctx.perms.has(p))) throw forbidden(`Requires one of: ${ps.join(", ")}`);
}

/** Opens an RLS-scoped transaction for the session's active organization and runs fn. */
export async function runAs<T>(auth: AuthState, meta: { requestId: string; ip?: string }, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const m = auth.active;
  if (!m) throw new AppError("FORBIDDEN", "You are not an active member of any organization");
  return withTenantTx({ orgId: m.orgId, userId: auth.user.id, orgType: m.orgType }, (db) =>
    fn({
      db,
      requestId: meta.requestId,
      ip: meta.ip,
      user: { id: auth.user.id, name: auth.user.name, email: auth.user.email, isPlatformAdmin: auth.user.isPlatformAdmin, timezone: auth.user.timezone },
      org: { id: m.orgId, name: m.orgName, type: m.orgType, timezone: m.orgTimezone, currency: m.orgCurrency, isDemo: m.orgIsDemo },
      roles: m.roles,
      perms: m.permissions,
    }),
  );
}
