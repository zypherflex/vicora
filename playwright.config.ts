import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

function loadEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const PORT = 3100;
const testEnv = loadEnv(".env.test");

/**
 * End-to-end tests run the real app against the isolated vicora_test database, reset and seeded
 * by the global setup. The background job runner is on so sandbox payment webhooks are delivered.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { ...testEnv, NODE_ENV: "development", JOBS_IN_PROCESS: "true", NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_MAP_TILE_URL: "none" },
  },
});
