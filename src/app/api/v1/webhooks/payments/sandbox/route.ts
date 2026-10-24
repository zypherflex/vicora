import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyWebhook } from "@/server/adapters/payments";
import { systemDb } from "@/server/db/client";
import { log } from "@/server/http/logger";
import { rateLimit } from "@/server/http/rate-limit";
import { processPaymentWebhook } from "@/server/services/finance";

const eventSchema = z.object({
  id: z.string().min(4).max(100),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  created: z.number(),
  data: z.object({ providerPaymentId: z.string().min(4).max(100), failureReason: z.string().nullable().optional() }),
});

/** Signed, idempotent webhook receiver. Reads the raw body so the signature covers exactly what was sent. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    await rateLimit(`webhook:${req.headers.get("x-forwarded-for") ?? "local"}`, 600, 60);
  } catch {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const v = verifyWebhook(raw, req.headers.get("x-vicora-signature"));
  if (!v.ok) {
    log.warn("webhook_rejected", { reason: v.reason });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const result = await processPaymentWebhook(systemDb(), "sandbox", parsed.data);
  return NextResponse.json({ received: true, ...result });
}
