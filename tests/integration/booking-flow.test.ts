import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as sandboxWebhook } from "@/app/api/v1/webhooks/payments/sandbox/route";
import { closeDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { uploadDocument } from "@/server/services/documents";
import { approvePayable, buildSandboxWebhook, completeShipment, createInvoice, getInvoice, payInvoice, processPaymentWebhook } from "@/server/services/finance";
import { createTender, dispatchLeg, recordLegMilestone, respondToTender } from "@/server/services/operations";
import { acceptQuote, submitQuote } from "@/server/services/quotes";
import { changeStatus, createShipment, getShipmentTwin } from "@/server/services/shipments";
import { as } from "@/server/testing/actors";
import { textPdf } from "@/server/testing/pdf";
import { codeOf, db, driverId, ftlInput, legsOf, line, orgId, unitId } from "./fixtures";

/**
 * Booking → quote → acceptance → tender → dispatch → milestones → POD → invoice → sandbox payment
 * → carrier payable → completion, driven through the same service functions the API routes call.
 */
let shipmentId: string;
let brokerQuoteId: string;
let carrierQuoteId: string;
let legId: string;
let invoiceId: string;
let ironwood: string;

const webhookRequest = (body: string, signature: string | null) =>
  new NextRequest("http://localhost/api/v1/webhooks/payments/sandbox", {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-vicora-signature": signature } : {}) },
    body,
  });

beforeAll(async () => {
  ironwood = await orgId("Ironwood Transport");
});
afterAll(closeDb);

describe("booking to delivery", () => {
  it("creates a draft, then requests quotes", async () => {
    const draft = await as("leo@lakeshore.demo", (c) => createShipment(c, ftlInput("Integration test load", false)));
    const [row] = await db().select().from(t.shipments).where(eq(t.shipments.id, draft.id));
    expect(row.status).toBe("DRAFT");
    expect(draft.reference).toMatch(/^VCR-\d{2}-\d{6}$/);
    // Providers cannot see a draft.
    expect(await codeOf(as("dana@meridian.demo", (c) => getShipmentTwin(c, draft.id)))).toBe("NOT_FOUND");
    await as("leo@lakeshore.demo", (c) => changeStatus(c, draft.id, "QUOTE_REQUESTED", null));
    shipmentId = draft.id;
  });

  it("collects quotes from a broker and a carrier with exact minor-unit totals", async () => {
    const q1 = await as("dana@meridian.demo", (c) =>
      submitQuote(c, shipmentId, { currency: "USD", lines: [line("LINEHAUL", "Linehaul", 2450), line("FUEL_SURCHARGE", "Fuel", 412.5), line("DETENTION", "Detention, 1.5 h", 75, 1500)], estimatedCostMinor: 2_300_00, transitDays: 2, notes: null }),
    );
    // 2450.00 + 412.50 + 1.5 × 75.00 = 2975.00
    expect(q1.totalMinor).toBe(2_975_00);
    const q2 = await as("ops@ironwood.demo", (c) => submitQuote(c, shipmentId, { currency: "USD", lines: [line("LINEHAUL", "Linehaul", 3100)], transitDays: 2, notes: null }));
    brokerQuoteId = q1.id;
    carrierQuoteId = q2.id;
    // A shipper role without quote.submit cannot quote.
    expect(await codeOf(as("leo@lakeshore.demo", (c) => submitQuote(c, shipmentId, { currency: "USD", lines: [line("LINEHAUL", "x", 1)], transitDays: 1, notes: null })))).toBe("FORBIDDEN");
  });

  it("accepts exactly one quote when two acceptances race", async () => {
    const results = await Promise.allSettled([
      as("maya@lakeshore.demo", (c) => acceptQuote(c, brokerQuoteId)),
      as("leo@lakeshore.demo", (c) => acceptQuote(c, carrierQuoteId)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(1);
    const [s] = await db().select().from(t.shipments).where(eq(t.shipments.id, shipmentId));
    const quotes = await db().select().from(t.quotes).where(eq(t.quotes.shipmentId, shipmentId));
    expect(quotes.filter((q) => q.status === "ACCEPTED").length).toBe(1);
    expect(s.acceptedQuoteId).toBe(quotes.find((q) => q.status === "ACCEPTED")!.id);
    // Receivable charges are created once, from the winning quote only.
    const receivables = await db().select().from(t.charges).where(and(eq(t.charges.shipmentId, shipmentId), eq(t.charges.kind, "RECEIVABLE")));
    expect(new Set(receivables.map((c) => c.sourceId))).toEqual(new Set([s.acceptedQuoteId]));
  });

  it("continues with the broker quote (resetting the race outcome if the carrier won)", async () => {
    const [s] = await db().select().from(t.shipments).where(eq(t.shipments.id, shipmentId));
    if (s.acceptedQuoteId !== brokerQuoteId) {
      // The carrier won the race; run the rest of the flow on a fresh shipment booked through the broker.
      const fresh = await as("leo@lakeshore.demo", (c) => createShipment(c, ftlInput("Integration test load (broker)")));
      const q = await as("dana@meridian.demo", (c) =>
        submitQuote(c, fresh.id, { currency: "USD", lines: [line("LINEHAUL", "Linehaul", 2450), line("FUEL_SURCHARGE", "Fuel", 412.5), line("DETENTION", "Detention, 1.5 h", 75, 1500)], estimatedCostMinor: 2_300_00, transitDays: 2, notes: null }),
      );
      shipmentId = fresh.id;
      brokerQuoteId = q.id;
      await as("maya@lakeshore.demo", (c) => acceptQuote(c, brokerQuoteId));
    }
    // Accepting the same quote again is an idempotent no-op.
    const again = await as("maya@lakeshore.demo", (c) => acceptQuote(c, brokerQuoteId));
    expect(again.alreadyAccepted).toBe(true);
    const [booked] = await db().select().from(t.shipments).where(eq(t.shipments.id, shipmentId));
    expect(booked.status).toBe("BOOKED");
  });

  it("tenders to a carrier, who accepts and dispatches", async () => {
    [{ id: legId }] = await legsOf(shipmentId);
    const tender = await as("dana@meridian.demo", (c) => createTender(c, shipmentId, { legId, carrierOrgId: ironwood, rateMinor: 2_350_00, currency: "USD", notes: null, expiresInHours: 4 }));
    // Another carrier cannot answer a tender addressed to Ironwood.
    expect(await codeOf(as("ops@desertsun.demo", (c) => respondToTender(c, tender.id, true, null)))).toBe("NOT_FOUND");
    await as("ops@ironwood.demo", (c) => respondToTender(c, tender.id, true, null));
    const [driver, unit] = await Promise.all([driverId("Denise Park"), unitId("IW-202")]);
    await as("ops@ironwood.demo", (c) => dispatchLeg(c, shipmentId, { legId, driverId: driver, equipmentId: unit }));
    const [s] = await db().select().from(t.shipments).where(eq(t.shipments.id, shipmentId));
    expect(s.status).toBe("DISPATCHED");
  });

  it("enforces milestone order and requires proof of delivery", async () => {
    const at = (s: "AT_PICKUP" | "PICKED_UP" | "IN_TRANSIT" | "DELIVERED", extra: Record<string, unknown> = {}) =>
      as("ops@ironwood.demo", (c) => recordLegMilestone(c, shipmentId, legId, { status: s, note: null, podSignerName: null, ...extra }));
    expect(await codeOf(at("DELIVERED", { podSignerName: "R. Diaz" }))).toBe("INVALID_TRANSITION");
    await at("AT_PICKUP");
    await at("PICKED_UP");
    await at("IN_TRANSIT");
    expect(await codeOf(at("DELIVERED"))).toBe("VALIDATION_FAILED");
    // The shipper cannot record carrier milestones.
    expect(await codeOf(as("leo@lakeshore.demo", (c) => recordLegMilestone(c, shipmentId, legId, { status: "DELIVERED", note: null, podSignerName: "x" })))).toBe("FORBIDDEN");
    const pod = await as("ops@ironwood.demo", (c) =>
      uploadDocument(c, { shipmentId, filename: "pod.pdf", data: textPdf([["FICTIONAL TEST DOCUMENT", "PROOF OF DELIVERY"]]), meta: { category: "PROOF_OF_DELIVERY", title: "POD", visibility: "SHARED", customerVisible: true } }),
    );
    await at("DELIVERED", { podDocumentId: pod.document.id, podSignerName: "R. Diaz" });
    const [s] = await db().select().from(t.shipments).where(eq(t.shipments.id, shipmentId));
    expect(s.status).toBe("DELIVERED");
  });

  it("invoices the customer from confirmed charges", async () => {
    expect(await codeOf(as("ap@lakeshore.demo", (c) => createInvoice(c, { shipmentId, dueInDays: 30, memo: null })))).toBe("FORBIDDEN");
    const { invoice } = await as("sam@meridian.demo", (c) => createInvoice(c, { shipmentId, dueInDays: 30, memo: null }));
    expect(invoice.totalMinor).toBe(2_975_00);
    expect(invoice.status).toBe("ISSUED");
    expect(await codeOf(as("sam@meridian.demo", (c) => createInvoice(c, { shipmentId, dueInDays: 30, memo: null })))).toBe("CONFLICT");
    invoiceId = invoice.id;
  });

  it("pays in the sandbox exactly once, through a signed webhook", async () => {
    const first = await as("ap@lakeshore.demo", (c) => payInvoice(c, invoiceId, { idempotencyKey: "it-pay-1", sandboxOutcome: "succeed" }));
    const replay = await as("ap@lakeshore.demo", (c) => payInvoice(c, invoiceId, { idempotencyKey: "it-pay-1", sandboxOutcome: "succeed" }));
    expect(replay.replayed).toBe(true);
    expect(replay.payment.id).toBe(first.payment.id);
    expect(first.payment.isSandbox).toBe(true);
    expect(await codeOf(as("ap@lakeshore.demo", (c) => payInvoice(c, invoiceId, { idempotencyKey: "it-pay-2", sandboxOutcome: "succeed" })))).toBe("CONFLICT");

    // Pick up the webhook the sandbox processor queued and deliver it to the real route handler.
    const jobs = await db().select().from(t.jobs).where(eq(t.jobs.type, "sandbox.deliver_webhook"));
    const job = jobs.find((j) => String((j.payload as { body: string }).body).includes(first.payment.providerPaymentId!));
    expect(job).toBeDefined();
    const body = String((job!.payload as { body: string }).body);
    await db().delete(t.jobs).where(eq(t.jobs.id, job!.id));

    expect((await sandboxWebhook(webhookRequest(body, null))).status).toBe(400);
    expect((await sandboxWebhook(webhookRequest(body, "t=1,v1=deadbeef"))).status).toBe(400);
    const tampered = body.replace('"payment.succeeded"', '"payment.failed"');
    expect((await sandboxWebhook(webhookRequest(tampered, buildSandboxWebhook(body).signature))).status).toBe(400);

    const ok = await sandboxWebhook(webhookRequest(body, buildSandboxWebhook(body).signature));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: true, duplicate: false, succeeded: true });
    const dup = await sandboxWebhook(webhookRequest(body, buildSandboxWebhook(body).signature));
    expect(await dup.json()).toMatchObject({ received: true, duplicate: true });

    const inv = await as("ap@lakeshore.demo", (c) => getInvoice(c, invoiceId));
    expect(inv.invoice.status).toBe("PAID");
    expect(inv.invoice.amountPaidMinor).toBe(2_975_00);
    const payments = await db().select().from(t.payments).where(eq(t.payments.invoiceId, invoiceId));
    expect(payments.map((p) => p.status)).toEqual(["SUCCEEDED"]);
  });

  it("ignores a webhook for an unknown payment", async () => {
    const r = await processPaymentWebhook(db(), "sandbox", { id: "sbx_evt_unknown_1", type: "payment.succeeded", data: { providerPaymentId: "sbx_pay_does_not_exist" } });
    expect(r).toMatchObject({ duplicate: false, ignored: true });
  });

  it("approves the carrier payable after POD and closes the shipment", async () => {
    const [payable] = await db().select().from(t.payables).where(eq(t.payables.shipmentId, shipmentId));
    expect(payable.amountMinor).toBe(2_350_00);
    expect(payable.payeeOrgId).toBe(ironwood);
    expect(await codeOf(as("ops@ironwood.demo", (c) => approvePayable(c, payable.id)))).toBe("NOT_FOUND");
    await as("sam@meridian.demo", (c) => approvePayable(c, payable.id));
    expect(await codeOf(as("leo@lakeshore.demo", (c) => completeShipment(c, shipmentId)))).toBe("FORBIDDEN");
    await as("dana@meridian.demo", (c) => completeShipment(c, shipmentId));

    const twin = await as("dana@meridian.demo", (c) => getShipmentTwin(c, shipmentId));
    expect(twin.shipment.status).toBe("COMPLETED");
    // 2975.00 revenue − 2350.00 carrier cost
    expect(twin.finance).toEqual({ revenueMinor: 2_975_00, costMinor: 2_350_00, marginMinor: 625_00 });
    expect(twin.history.map((h) => h.toStatus)).toEqual(expect.arrayContaining(["QUOTE_REQUESTED", "BOOKED", "ASSIGNED", "DISPATCHED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "COMPLETED"]));
  });
});
