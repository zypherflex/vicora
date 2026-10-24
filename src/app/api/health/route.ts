import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { systemDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await systemDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
