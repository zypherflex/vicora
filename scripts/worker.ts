import "./load-env";
import { enqueuePeriodic, requeueStuck, runDueJobs } from "@/server/jobs/worker";
import { log } from "@/server/http/logger";

// Standalone worker for production: `npm run worker`. Set JOBS_IN_PROCESS=false on web instances.
log.info("worker_started");
let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));
while (!stopping) {
  try {
    await requeueStuck();
    await enqueuePeriodic();
    const n = await runDueJobs(50);
    if (n === 0) await new Promise((r) => setTimeout(r, 1000));
  } catch (err) {
    log.error("worker_loop_error", { err: String(err) });
    await new Promise((r) => setTimeout(r, 5000));
  }
}
process.exit(0);
