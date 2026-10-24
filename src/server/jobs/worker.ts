import { and, eq, lte, sql } from "drizzle-orm";
import { systemDb } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { env } from "@/server/env";
import { log } from "@/server/http/logger";
import { buildSandboxWebhook } from "@/server/services/finance";
import { notifyOrg, notifyShipmentEvent } from "@/server/services/comms";
import { runExtraction } from "@/server/services/customs";
import { processComplianceExpirations } from "@/server/services/compliance";
import { purgeExpiredDocuments } from "@/server/services/documents";
import { persistRuleExceptions } from "@/server/services/attention";
import { enqueue } from "@/server/services/common";

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  "notify.shipment_event": (p) => notifyShipmentEvent(systemDb(), String(p.eventId)),
  "notify.org": (p) =>
    notifyOrg(systemDb(), {
      orgId: String(p.orgId),
      type: String(p.type),
      title: String(p.title),
      body: (p.body as string) ?? null,
      link: (p.link as string) ?? null,
      shipmentId: (p.shipmentId as string) ?? null,
    }),
  "notify.user": async (p) => {
    const { notifications } = await import("@/server/db/schema");
    await systemDb().insert(notifications).values({ userId: String(p.userId), orgId: String(p.orgId), type: String(p.type), title: String(p.title), link: (p.link as string) ?? null, shipmentId: (p.shipmentId as string) ?? null });
  },
  "document.extract": (p) => runExtraction(systemDb(), String(p.extractionId)),
  // Simulates the sandbox processor calling our public webhook endpoint with a signed payload.
  "sandbox.deliver_webhook": async (p) => {
    const { body, signature } = buildSandboxWebhook(String(p.body));
    const res = await fetch(`${env().APP_URL}/api/v1/webhooks/payments/sandbox`, { method: "POST", headers: { "content-type": "application/json", "x-vicora-signature": signature }, body });
    if (!res.ok) throw new Error(`webhook delivery failed: ${res.status}`);
  },
  "scan.rules": () => persistRuleExceptions(systemDb()),
  "compliance.expirations": () => processComplianceExpirations(systemDb()),
  "documents.retention": () => purgeExpiredDocuments(systemDb()),
};

/** Claim and run up to `limit` due jobs. Uses SKIP LOCKED so several workers can run safely. */
export async function runDueJobs(limit = 20): Promise<number> {
  const db = systemDb();
  const claimed = await db.execute<{ id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(sql`
    update jobs set status = 'RUNNING', locked_at = now(), attempts = attempts + 1
    where id in (select id from jobs where status = 'QUEUED' and run_at <= now() order by run_at limit ${limit} for update skip locked)
    returning id, type, payload, attempts, max_attempts`);
  for (const j of claimed) {
    const h = handlers[j.type];
    try {
      if (!h) throw new Error(`No handler for job type ${j.type}`);
      await h(j.payload);
      await db.update(jobs).set({ status: "DONE", lockedAt: null }).where(eq(jobs.id, j.id));
    } catch (err) {
      const retry = j.attempts < j.max_attempts;
      const backoff = Math.min(2 ** j.attempts * 5, 900);
      await db
        .update(jobs)
        .set({ status: retry ? "QUEUED" : "FAILED", lastError: String((err as Error)?.message ?? err).slice(0, 1000), lockedAt: null, runAt: sql`now() + ${`${backoff} seconds`}::interval` })
        .where(eq(jobs.id, j.id));
      log.warn("job_failed", { jobId: j.id, type: j.type, attempts: j.attempts, retry, err: String(err) });
    }
  }
  return claimed.length;
}

/** Recover jobs stuck in RUNNING (e.g. the worker crashed) after 10 minutes. */
export async function requeueStuck() {
  await systemDb().update(jobs).set({ status: "QUEUED" }).where(and(eq(jobs.status, "RUNNING"), lte(jobs.lockedAt, new Date(Date.now() - 10 * 60_000))));
}

/** Periodic schedules, deduplicated per time bucket so multiple workers don't double-enqueue. */
export async function enqueuePeriodic(now = new Date()) {
  const db = systemDb();
  const tenMin = Math.floor(+now / 600_000);
  const day = now.toISOString().slice(0, 10);
  await enqueue(db, "scan.rules", {}, { dedupeKey: `scan.rules:${tenMin}` });
  await enqueue(db, "compliance.expirations", {}, { dedupeKey: `compliance:${day}` });
  await enqueue(db, "documents.retention", {}, { dedupeKey: `retention:${day}` });
}

let started = false;
export function startInProcessWorker() {
  if (started) return;
  started = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await requeueStuck();
      await enqueuePeriodic();
      while ((await runDueJobs()) > 0) {
        /* drain */
      }
    } catch (err) {
      log.error("worker_tick_failed", { err: String(err) });
    } finally {
      busy = false;
    }
  };
  setInterval(tick, 2000).unref?.();
  log.info("in_process_worker_started");
}
