import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { loadMemberships, type AuthState } from "@/server/auth/session";
import { runAs, type Ctx } from "@/server/authz/context";
import { systemDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

/**
 * Run code as a real user in one of their organizations, through the same RLS-scoped path
 * that web requests use. Used by the seed script and integration tests (never by request handlers).
 */
export async function authFor(email: string, orgId?: string): Promise<AuthState> {
  const [u] = await systemDb().select().from(users).where(eq(users.email, email));
  if (!u) throw new Error(`No user ${email}`);
  const ms = await loadMemberships(u.id);
  const active = orgId ? ms.find((m) => m.orgId === orgId) ?? null : ms[0] ?? null;
  return {
    sessionId: "test",
    user: { id: u.id, email: u.email, name: u.name, timezone: u.timezone, isPlatformAdmin: u.isPlatformAdmin, isDemo: u.isDemo },
    memberships: ms,
    active,
  };
}

export async function as<T>(email: string, fn: (ctx: Ctx) => Promise<T>, orgId?: string): Promise<T> {
  return runAs(await authFor(email, orgId), { requestId: `script-${randomUUID()}` }, fn);
}
