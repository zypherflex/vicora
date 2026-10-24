import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

type Pools = { app: DB; system: DB; appClient: postgres.Sql; systemClient: postgres.Sql };
const g = globalThis as unknown as { __vicoraDb?: Pools };

function create(): Pools {
  const opts = { max: env().DB_POOL_MAX, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} };
  const appClient = postgres(env().DATABASE_URL, opts);
  const systemClient = postgres(env().DATABASE_SYSTEM_URL, opts);
  return {
    appClient,
    systemClient,
    app: drizzle(appClient, { schema }),
    system: drizzle(systemClient, { schema }),
  };
}

function pools(): Pools {
  if (!g.__vicoraDb) g.__vicoraDb = create();
  return g.__vicoraDb;
}

/**
 * The system database bypasses row-level security. Use it only for authentication,
 * background jobs, signed webhooks, public tracking-token lookups and platform administration.
 */
export function systemDb(): DB {
  return pools().system;
}

/** Run a function inside a transaction whose row-level security context is bound to one org and user. */
export async function withTenantTx<T>(
  scope: { orgId: string; userId: string; orgType: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return pools().app.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${scope.orgId}, true), set_config('app.user_id', ${scope.userId}, true), set_config('app.org_type', ${scope.orgType}, true)`,
    );
    return fn(tx);
  });
}

export async function closeDb() {
  if (!g.__vicoraDb) return;
  await Promise.all([g.__vicoraDb.appClient.end({ timeout: 5 }), g.__vicoraDb.systemClient.end({ timeout: 5 })]);
  g.__vicoraDb = undefined;
}
