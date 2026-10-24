export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.JOBS_IN_PROCESS !== "false") {
    const { startInProcessWorker } = await import("@/server/jobs/worker");
    startInProcessWorker();
  }
}
