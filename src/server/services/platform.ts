import { desc, eq, sql } from "drizzle-orm";
import type { AuthState } from "@/server/auth/session";
import { systemDb } from "@/server/db/client";
import { auditLog, jobs, organizations, outboundMessages, webhookEvents } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/http/errors";

/** Platform administration runs outside tenant scope and is restricted to platform administrators. */
function assertPlatformAdmin(auth: AuthState) {
  if (!auth.user.isPlatformAdmin) throw forbidden("Platform administrators only");
}

export async function platformOverview(auth: AuthState) {
  assertPlatformAdmin(auth);
  const db = systemDb();
  const [orgs, jobStats, outbox, webhooks, recentAudit] = await Promise.all([
    db.execute<{ id: string; name: string; type: string; status: string; is_demo: boolean; members: number; shipments: number; created_at: Date }>(sql`
      select o.id, o.name, o.type, o.status, o.is_demo, o.created_at,
        (select count(*)::int from memberships m where m.org_id = o.id) as members,
        (select count(*)::int from shipments s where s.owner_org_id = o.id) as shipments
      from organizations o order by o.created_at desc`),
    db.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from jobs group by status`),
    db.select().from(outboundMessages).orderBy(desc(outboundMessages.createdAt)).limit(25),
    db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(25),
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(50),
  ]);
  const failedJobs = await db.select().from(jobs).where(eq(jobs.status, "FAILED")).orderBy(desc(jobs.createdAt)).limit(20);
  return { orgs, jobStats, outbox, webhooks, recentAudit, failedJobs };
}

export async function setOrgStatus(auth: AuthState, orgId: string, status: "ACTIVE" | "SUSPENDED") {
  assertPlatformAdmin(auth);
  const db = systemDb();
  const res = await db.update(organizations).set({ status }).where(eq(organizations.id, orgId)).returning({ id: organizations.id });
  if (!res.length) throw notFound("Organization");
  await db.insert(auditLog).values({ orgId, actorUserId: auth.user.id, action: `platform.org_${status.toLowerCase()}`, entityType: "organization", entityId: orgId });
}
