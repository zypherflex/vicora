import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, deleteSession } from "@/server/auth/session";
import { clearSessionCookie } from "@/server/http/api";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
