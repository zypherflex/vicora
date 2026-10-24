import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Row-level-security constrained role used by web requests. */
  DATABASE_URL: z.string().min(1),
  /** Schema owner role used for migrations, jobs, auth lookups and webhooks. */
  DATABASE_SYSTEM_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** HMAC key for signed download URLs and tracking tokens. 32+ random bytes. */
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
  PAYMENTS_PROVIDER: z.enum(["sandbox", "stripe"]).default("sandbox"),
  PAYMENTS_WEBHOOK_SECRET: z.string().min(16).default("dev_only_sandbox_webhook_secret"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  EMAIL_PROVIDER: z.enum(["outbox", "none"]).default("outbox"),
  JOBS_IN_PROCESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
