import { and, eq, gt, sql } from "drizzle-orm";
import type { OrgType } from "@/lib/domain";
import { effectivePermissions, type Permission } from "@/lib/permissions";
import { systemDb } from "@/server/db/client";
import { memberships, organizations, sessions, users } from "@/server/db/schema";
import { env } from "@/server/env";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "vicora_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
  isPlatformAdmin: boolean;
  isDemo: boolean;
}
export interface AuthMembership {
  membershipId: string;
  orgId: string;
  orgName: string;
  orgType: OrgType;
  orgTimezone: string;
  orgCurrency: string;
  orgIsDemo: boolean;
  roles: string[];
  permissions: Set<Permission>;
}
export interface AuthState {
  sessionId: string;
  user: AuthUser;
  memberships: AuthMembership[];
  active: AuthMembership | null;
}

export async function createSession(userId: string, activeOrgId: string | null, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 86400_000);
  await systemDb()
    .insert(sessions)
    .values({ id: sha256Hex(token), userId, activeOrgId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) });
  return { token, expiresAt };
}

export async function deleteSession(token: string) {
  await systemDb().delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}

export async function setActiveOrg(sessionId: string, orgId: string) {
  await systemDb().update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, sessionId));
}

export async function loadMemberships(userId: string): Promise<AuthMembership[]> {
  const rows = await systemDb()
    .select({
      membershipId: memberships.id,
      roles: memberships.roles,
      grants: memberships.grants,
      revocations: memberships.revocations,
      orgId: organizations.id,
      orgName: organizations.name,
      orgType: organizations.type,
      orgTimezone: organizations.timezone,
      orgCurrency: organizations.defaultCurrency,
      orgIsDemo: organizations.isDemo,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE"), eq(organizations.status, "ACTIVE")))
    .orderBy(organizations.name);
  return rows.map((r) => ({
    membershipId: r.membershipId,
    orgId: r.orgId,
    orgName: r.orgName,
    orgType: r.orgType,
    orgTimezone: r.orgTimezone,
    orgCurrency: r.orgCurrency,
    orgIsDemo: r.orgIsDemo,
    roles: r.roles,
    permissions: effectivePermissions(r.orgType, r.roles, r.grants, r.revocations),
  }));
}

/** Resolve a raw session token into an authenticated state, sliding the expiry when it is half used. */
export async function resolveSession(token: string | undefined | null): Promise<AuthState | null> {
  if (!token || token.length > 200) return null;
  const sid = sha256Hex(token);
  const db = systemDb();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      activeOrgId: sessions.activeOrgId,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      timezone: users.timezone,
      isPlatformAdmin: users.isPlatformAdmin,
      isDemo: users.isDemo,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.disabledAt) return null;

  const ttl = env().SESSION_TTL_DAYS * 86400_000;
  if (row.expiresAt.getTime() - Date.now() < ttl / 2) {
    await db.update(sessions).set({ expiresAt: sql`now() + ${`${env().SESSION_TTL_DAYS} days`}::interval` }).where(eq(sessions.id, sid));
  }

  const ms = await loadMemberships(row.id);
  const active = ms.find((m) => m.orgId === row.activeOrgId) ?? ms[0] ?? null;
  return {
    sessionId: sid,
    user: { id: row.id, email: row.email, name: row.name, timezone: row.timezone, isPlatformAdmin: row.isPlatformAdmin, isDemo: row.isDemo },
    memberships: ms,
    active,
  };
}
