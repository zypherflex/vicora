// Minimal .env loader for scripts (Next.js loads .env itself for the web app).
import { existsSync, readFileSync } from "node:fs";

const file = process.env.ENV_FILE ?? ".env";
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
