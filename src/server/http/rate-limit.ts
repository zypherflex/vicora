import { sql } from "drizzle-orm";
import { systemDb } from "@/server/db/client";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter stored in PostgreSQL so it holds across multiple web instances.
 * Throws RATE_LIMITED when the window's budget is exhausted.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await systemDb().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart.toISOString()}::timestamptz, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    const retryAfter = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000);
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait and try again.", { retryAfterSeconds: retryAfter });
  }
}
