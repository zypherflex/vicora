import "./load-env";
import postgres from "postgres";

// Drops and recreates the public schema, then re-runs migrations. Development only.
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
const url = process.env.DATABASE_SYSTEM_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
await sql.end();
await import("./migrate");
