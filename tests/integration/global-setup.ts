import { execSync } from "node:child_process";

/**
 * Rebuild the isolated vicora_test database once per run: drop the schema, apply every migration
 * (including the row-level security policies), then load the fictional demo seed through the real
 * service layer. Never points at the development or production database.
 */
export default function setup() {
  const env: NodeJS.ProcessEnv = { ...process.env, ENV_FILE: ".env.test", NODE_ENV: "test" };
  for (const k of ["DATABASE_URL", "DATABASE_SYSTEM_URL"]) delete env[k];
  execSync("npx tsx scripts/reset.ts", { env, stdio: "inherit" });
  execSync("npx tsx scripts/seed.ts", { env, stdio: "ignore" });
}
