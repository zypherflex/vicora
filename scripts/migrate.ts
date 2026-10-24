import "./load-env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_SYSTEM_URL;
if (!url) throw new Error("DATABASE_SYSTEM_URL is required");
const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
console.log("migrations applied");
await client.end();
