import { randomUUID } from "node:crypto";
import { hmac, safeEqual } from "@/server/auth/crypto";
import { env } from "@/server/env";
import { AppError } from "@/server/http/errors";

/**
 * Payment provider adapter. Vicora never receives or stores card numbers: a real provider
 * (e.g. Stripe) would collect payment details on its hosted page and notify us by signed webhook.
 *
 * Only the SANDBOX provider is implemented. It simulates a hosted checkout and delivers a
 * signed webhook back to /api/v1/webhooks/payments/sandbox through the job queue. No money moves.
 */
export interface CreatePaymentRequest {
  amountMinor: number;
  currency: string;
  invoiceNumber: string;
  idempotencyKey: string;
  outcome?: "succeed" | "decline";
}
export interface CreatePaymentResult {
  providerPaymentId: string;
  status: "PENDING";
  isSandbox: boolean;
}
export interface PaymentProvider {
  readonly name: string;
  readonly isSandbox: boolean;
  createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult>;
}

export const sandboxProvider: PaymentProvider = {
  name: "sandbox",
  isSandbox: true,
  async createPayment() {
    return { providerPaymentId: `sbx_pay_${randomUUID().replace(/-/g, "").slice(0, 20)}`, status: "PENDING", isSandbox: true };
  },
};

const stripeNotConnected: PaymentProvider = {
  name: "stripe",
  isSandbox: false,
  async createPayment() {
    throw new AppError(
      "NOT_CONNECTED",
      "Stripe is not connected. Implement the Stripe adapter (PaymentIntents + hosted Checkout), set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, and register the webhook endpoint.",
    );
  },
};

export function paymentProvider(): PaymentProvider {
  return env().PAYMENTS_PROVIDER === "stripe" ? stripeNotConnected : sandboxProvider;
}

/* ---------------------------------------------------------------- Webhook signatures */

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Header format: `t=<unix seconds>,v1=<base64url HMAC-SHA256 of "t.body">` */
export function signWebhook(body: string, secret = env().PAYMENTS_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${hmac(`${t}.${body}`, secret)}`;
}

export function verifyWebhook(body: string, header: string | null, secret = env().PAYMENTS_WEBHOOK_SECRET, now = Math.floor(Date.now() / 1000)) {
  if (!header) return { ok: false as const, reason: "missing signature" };
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return { ok: false as const, reason: "malformed signature" };
  if (Math.abs(now - t) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false as const, reason: "timestamp outside tolerance" };
  if (!safeEqual(hmac(`${t}.${body}`, secret), parts.v1)) return { ok: false as const, reason: "signature mismatch" };
  return { ok: true as const };
}
