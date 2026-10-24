import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_SYSTEM_URL ?? "postgres://vicora_owner:vicora_owner@localhost:5432/vicora" },
});
