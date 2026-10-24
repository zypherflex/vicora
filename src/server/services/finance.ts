import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { lineAmount, type Currency } from "@/lib/money";
import { paymentProvider, signWebhook } from "@/server/adapters/payments";
import { requirePerm, type Ctx } from "@/server/authz/context";
import type { DB } from "@/server/db/client";
import { charges, creditNotes, documents, invoiceLines, invoices, organizations, payables, payments, shipments, webhookEvents } from "@/server/db/schema";
import { AppError, conflict, notFound } from "@/server/http/errors";
import type { chargeSchema, createInvoiceSchema, creditNoteSchema, payInvoiceSchema } from "@/server/validators";
import { audit, enqueue, nextCounter, recordEvent, requireParty } from "./common";
import { transitionShipment } from "./status";

/* ---------------------------------------------------------------- Pure calculations (unit tested) */

export function computeInvoiceTotals(lineAmounts: number[], creditAmounts: number[], paidMinor: number) {
  for (const n of [...lineAmounts, ...creditAmounts, paidMinor]) if (!Number.isSafeInteger(n)) throw new RangeError("Amounts must be integers");
  const subtotalMinor = lineAmounts.reduce((a, b) => a + b, 0);
  const creditsMinor = creditAmounts.reduce((a, b) => a + b, 0);
  if (creditsMinor > subtotalMinor) throw new RangeError("Credits cannot exceed the invoice subtotal");
  const totalMinor = subtotalMinor - creditsMinor;
  const balanceMinor = totalMinor - paidMinor;
  const status: "ISSUED" | "PARTIALLY_PAID" | "PAID" = balanceMinor <= 0 ? "PAID" : paidMinor > 0 ? "PARTIALLY_PAID" : "ISSUED";
  return { subtotalMinor, creditsMinor, totalMinor, balanceMinor, status };
}

/* ---------------------------------------------------------------- Charges */

/**
 * Add a charge after booking (e.g. detention). It starts ESTIMATED and only becomes CONFIRMED
 * when the bill-to organization approves it. Providers bill the customer; carriers bill their broker.
 */
export async function addCharge(ctx: Ctx, shipmentId: string, input: z.infer<typeof chargeSchema>) {
  requirePerm(ctx, "finance.manage");
  const access = await requireParty(ctx, shipmentId);
  const s = access.shipment;
  let billTo: string;
  let kind: "RECEIVABLE" | "PAYABLE";
  if (access.isProvider) {
    billTo = s.ownerOrgId;
    kind = "RECEIVABLE";
  } else if (access.isExecutor) {
    if (!s.primaryProviderOrgId || s.primaryProviderOrgId === ctx.org.id) throw conflict("No managing broker to bill on this shipment");
    billTo = s.primaryProviderOrgId;
    kind = "PAYABLE";
  } else throw new AppError("FORBIDDEN", "Only providers on this shipment can add charges");
  const amountMinor = lineAmount(input.quantityMilli, input.unitAmountMinor);
  const [c] = await ctx.db
    .insert(charges)
    .values({ shipmentId, kind, billerOrgId: ctx.org.id, billToOrgId: billTo, ...input, amountMinor, currency: s.currency, status: "ESTIMATED", source: "MANUAL", createdBy: ctx.user.id })
    .returning();
  await enqueue(ctx.db, "notify.org", {
    orgId: billTo,
    type: "CHARGE_PENDING",
    title: `Charge awaiting approval on ${s.reference}`,
    body: `${ctx.org.name} added "${input.description}".`,
    link: `/shipments/${shipmentId}?tab=finance`,
    shipmentId,
  });
  await audit(ctx, "charge.added", "charge", c.id, { after: { amountMinor, kind, code: input.code } });
  return c;
}

export async function decideCharge(ctx: Ctx, chargeId: string, approve: boolean) {
  requirePerm(ctx, "finance.manage");
  const [c] = await ctx.db.select().from(charges).where(eq(charges.id, chargeId));
  if (!c) throw notFound("Charge");
  if (c.billToOrgId !== ctx.org.id) throw new AppError("FORBIDDEN", "Only the billed organization can approve this charge");
  if (c.status !== "ESTIMATED") throw conflict("Only estimated charges can be approved or rejected");
  await ctx.db
    .update(charges)
    .set(approve ? { status: "CONFIRMED", confirmedBy: ctx.user.id, confirmedAt: new Date() } : { status: "VOID" })
    .where(eq(charges.id, c.id));
  if (approve && c.kind === "PAYABLE") {
    await ctx.db
      .update(payables)
      .set({ amountMinor: sql`${payables.amountMinor} + ${c.amountMinor}` })
      .where(and(eq(payables.shipmentId, c.shipmentId), eq(payables.payeeOrgId, c.billerOrgId), inArray(payables.status, ["PENDING_POD", "APPROVED"])));
  }
  await audit(ctx, approve ? "charge.approved" : "charge.rejected", "charge", c.id, { after: { amountMinor: c.amountMinor } });
}

/* ---------------------------------------------------------------- Invoices */

export async function createInvoice(ctx: Ctx, input: z.infer<typeof createInvoiceSchema>) {
  requirePerm(ctx, "invoice.create");
  const access = await requireParty(ctx, input.shipmentId);
  const s = access.shipment;
  if (!["DELIVERED", "COMPLETED"].includes(s.status)) throw conflict("Invoices can be created once the shipment is delivered");
  const open = await ctx.db
    .select()
    .from(charges)
    .where(and(eq(charges.shipmentId, s.id), eq(charges.billerOrgId, ctx.org.id), eq(charges.status, "CONFIRMED"), isNull(charges.invoiceId)));
  if (!open.length) throw conflict("There are no confirmed, uninvoiced charges to bill");
  const billTos = [...new Set(open.map((c) => c.billToOrgId))];
  const currencies = [...new Set(open.map((c) => c.currency))];
  if (billTos.length !== 1) throw conflict("Charges are billed to more than one organization; invoice them separately");
  if (currencies.length !== 1) throw conflict("Charges use more than one currency; invoice each currency separately");

  const pending = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(charges)
    .where(and(eq(charges.shipmentId, s.id), eq(charges.billerOrgId, ctx.org.id), eq(charges.status, "ESTIMATED")));

  const totals = computeInvoiceTotals(open.map((c) => c.amountMinor), [], 0);
  const seq = await nextCounter(ctx.db, `invoice:${ctx.org.id}:${new Date().getUTCFullYear()}`);
  const number = `INV-${new Date().getUTCFullYear()}-${String(seq).padStart(5, "0")}`;
  const now = new Date();
  const [inv] = await ctx.db
    .insert(invoices)
    .values({
      number,
      issuerOrgId: ctx.org.id,
      billToOrgId: billTos[0],
      shipmentId: s.id,
      status: "ISSUED",
      currency: currencies[0],
      subtotalMinor: totals.subtotalMinor,
      totalMinor: totals.totalMinor,
      issuedAt: now,
      dueAt: new Date(now.getTime() + input.dueInDays * 86400_000),
      memo: input.memo,
      isDemo: s.isDemo,
      createdBy: ctx.user.id,
    })
    .returning();
  await ctx.db.insert(invoiceLines).values(
    open.map((c) => ({ invoiceId: inv.id, chargeId: c.id, code: c.code, description: c.description, quantityMilli: c.quantityMilli, unitAmountMinor: c.unitAmountMinor, amountMinor: c.amountMinor })),
  );
  await ctx.db.update(charges).set({ invoiceId: inv.id }).where(inArray(charges.id, open.map((c) => c.id)));
  // Amounts are intentionally omitted from the shared timeline so carriers never see customer pricing.
  await recordEvent(ctx, s.id, { type: "INVOICE_ISSUED", title: `Invoice ${number} issued`, detail: { invoiceId: inv.id }, internal: access.isExecutor && !access.isProvider });
  await enqueue(ctx.db, "notify.org", { orgId: billTos[0], type: "INVOICE_ISSUED", title: `Invoice ${number} from ${ctx.org.name}`, link: `/finance/invoices/${inv.id}`, shipmentId: s.id });
  await audit(ctx, "invoice.issued", "invoice", inv.id, { after: { number, totalMinor: inv.totalMinor, currency: inv.currency } });
  return { invoice: inv, pendingEstimatedCharges: pending[0]?.n ?? 0 };
}

export async function getInvoice(ctx: Ctx, invoiceId: string) {
  requirePerm(ctx, "finance.read");
  const [inv] = await ctx.db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw notFound("Invoice");
  const [lines, credits, pays, orgs, ship] = await Promise.all([
    ctx.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)),
    ctx.db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv.id)),
    ctx.db.select().from(payments).where(eq(payments.invoiceId, inv.id)).orderBy(desc(payments.createdAt)),
    ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, [inv.issuerOrgId, inv.billToOrgId])),
    inv.shipmentId ? ctx.db.select({ reference: shipments.reference, title: shipments.title }).from(shipments).where(eq(shipments.id, inv.shipmentId)) : Promise.resolve([]),
  ]);
  return {
    invoice: { ...inv, balanceMinor: inv.totalMinor - inv.amountPaidMinor },
    lines,
    credits,
    payments: pays,
    issuer: orgs.find((o) => o.id === inv.issuerOrgId)!,
    billTo: orgs.find((o) => o.id === inv.billToOrgId)!,
    shipment: ship[0] ?? null,
    isIssuer: inv.issuerOrgId === ctx.org.id,
    isPayer: inv.billToOrgId === ctx.org.id,
  };
}

export async function listInvoices(ctx: Ctx) {
  requirePerm(ctx, "finance.read");
  const rows = await ctx.db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(200);
  const orgIds = [...new Set(rows.flatMap((r) => [r.issuerOrgId, r.billToOrgId]))];
  const orgs = orgIds.length ? await ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)) : [];
  const name = (id: string) => orgs.find((o) => o.id === id)?.name ?? "";
  return rows.map((r) => ({ ...r, balanceMinor: r.totalMinor - r.amountPaidMinor, issuerName: name(r.issuerOrgId), billToName: name(r.billToOrgId), direction: r.issuerOrgId === ctx.org.id ? "RECEIVABLE" : "PAYABLE" }));
}

export async function addCreditNote(ctx: Ctx, invoiceId: string, input: z.infer<typeof creditNoteSchema>) {
  requirePerm(ctx, "finance.manage");
  const [inv] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.issuerOrgId, ctx.org.id)));
  if (!inv) throw notFound("Invoice");
  if (!["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) throw conflict("Credits can only be applied to open invoices");
  const existing = await ctx.db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv.id));
  const lines = await ctx.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
  const totals = computeInvoiceTotals(lines.map((l) => l.amountMinor), [...existing.map((c) => c.amountMinor), input.amountMinor], inv.amountPaidMinor);
  if (totals.balanceMinor < 0) throw conflict("Credit exceeds the outstanding balance");
  await ctx.db.insert(creditNotes).values({ invoiceId: inv.id, amountMinor: input.amountMinor, currency: inv.currency, reason: input.reason, createdBy: ctx.user.id });
  await ctx.db.update(invoices).set({ creditsMinor: totals.creditsMinor, totalMinor: totals.totalMinor, status: totals.status }).where(eq(invoices.id, inv.id));
  await audit(ctx, "invoice.credited", "invoice", inv.id, { before: { totalMinor: inv.totalMinor }, after: { totalMinor: totals.totalMinor, reason: input.reason } });
}

/** Start a payment. Idempotent per idempotencyKey: retries return the same payment. */
export async function payInvoice(ctx: Ctx, invoiceId: string, input: z.infer<typeof payInvoiceSchema>) {
  requirePerm(ctx, "payment.make");
  const [inv] = await ctx.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.billToOrgId, ctx.org.id)));
  if (!inv) throw notFound("Invoice");
  const [prior] = await ctx.db.select().from(payments).where(eq(payments.idempotencyKey, `${ctx.org.id}:${input.idempotencyKey}`));
  if (prior) return { payment: prior, replayed: true };
  if (!["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) throw conflict(`Invoice is ${inv.status.toLowerCase()}`);
  const pending = await ctx.db.select().from(payments).where(and(eq(payments.invoiceId, inv.id), eq(payments.status, "PENDING")));
  if (pending.length) throw conflict("A payment for this invoice is already processing");
  const amount = inv.totalMinor - inv.amountPaidMinor;
  if (amount <= 0) throw conflict("Nothing is owed on this invoice");

  const provider = paymentProvider();
  const result = await provider.createPayment({ amountMinor: amount, currency: inv.currency, invoiceNumber: inv.number, idempotencyKey: input.idempotencyKey, outcome: input.sandboxOutcome });
  const [payment] = await ctx.db
    .insert(payments)
    .values({
      invoiceId: inv.id,
      payerOrgId: ctx.org.id,
      payeeOrgId: inv.issuerOrgId,
      amountMinor: amount,
      currency: inv.currency,
      provider: provider.name,
      providerPaymentId: result.providerPaymentId,
      isSandbox: result.isSandbox,
      idempotencyKey: `${ctx.org.id}:${input.idempotencyKey}`,
      createdBy: ctx.user.id,
    })
    .returning();
  if (provider.isSandbox) {
    // The sandbox "processor" calls back through our real webhook endpoint with a signed payload.
    const evt = {
      id: `sbx_evt_${payment.id.replace(/-/g, "").slice(0, 20)}`,
      type: input.sandboxOutcome === "decline" ? "payment.failed" : "payment.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: { providerPaymentId: result.providerPaymentId, amountMinor: amount, currency: inv.currency, failureReason: input.sandboxOutcome === "decline" ? "Sandbox: card declined (simulated)" : null },
    };
    await enqueue(ctx.db, "sandbox.deliver_webhook", { body: JSON.stringify(evt) }, { runAt: new Date(Date.now() + 1500) });
  }
  await audit(ctx, "payment.initiated", "payment", payment.id, { after: { amountMinor: amount, provider: provider.name, sandbox: result.isSandbox } });
  return { payment, replayed: false };
}

export function buildSandboxWebhook(body: string) {
  return { body, signature: signWebhook(body) };
}

/**
 * Process a verified payment webhook exactly once. Duplicate deliveries (same provider event id)
 * are acknowledged without reprocessing. Runs with the system connection because the
 * provider is not a tenant; every write is scoped by the payment record it references.
 */
export async function processPaymentWebhook(db: DB, provider: string, evt: { id: string; type: string; data: { providerPaymentId: string; failureReason?: string | null } }) {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ provider, eventId: evt.id, type: evt.type, payload: evt })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!inserted.length) return { duplicate: true as const };
    const whId = inserted[0].id;

    const [p] = await tx.select().from(payments).where(eq(payments.providerPaymentId, evt.data.providerPaymentId)).for("update");
    if (!p) {
      await tx.update(webhookEvents).set({ status: "IGNORED", error: "unknown payment", processedAt: new Date() }).where(eq(webhookEvents.id, whId));
      return { duplicate: false as const, ignored: true };
    }
    if (p.status !== "PENDING") {
      await tx.update(webhookEvents).set({ status: "IGNORED", error: `payment already ${p.status}`, processedAt: new Date() }).where(eq(webhookEvents.id, whId));
      return { duplicate: false as const, ignored: true };
    }
    const succeeded = evt.type === "payment.succeeded";
    await tx
      .update(payments)
      .set({ status: succeeded ? "SUCCEEDED" : "FAILED", failureReason: succeeded ? null : evt.data.failureReason ?? "Payment failed", updatedAt: new Date() })
      .where(eq(payments.id, p.id));
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId)).for("update");
    if (succeeded) {
      const paid = inv.amountPaidMinor + p.amountMinor;
      const lines = await tx.select({ a: invoiceLines.amountMinor }).from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
      const credits = await tx.select({ a: creditNotes.amountMinor }).from(creditNotes).where(eq(creditNotes.invoiceId, inv.id));
      const totals = computeInvoiceTotals(lines.map((l) => l.a), credits.map((c) => c.a), paid);
      await tx.update(invoices).set({ amountPaidMinor: paid, status: totals.status }).where(eq(invoices.id, inv.id));
    }
    if (inv.shipmentId) {
      await tx.execute(sql`insert into shipment_events (shipment_id, type, title, detail, visible_to_org_id)
        values (${inv.shipmentId}, ${succeeded ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED"},
        ${`${p.isSandbox ? "[Sandbox] " : ""}Payment ${succeeded ? "received" : "failed"} for ${inv.number}`},
        ${JSON.stringify({ paymentId: p.id })}::jsonb, ${inv.issuerOrgId})`);
    }
    for (const orgId of [inv.issuerOrgId, inv.billToOrgId]) {
      await enqueue(tx, "notify.org", {
        orgId,
        type: succeeded ? "PAYMENT_SUCCEEDED" : "PAYMENT_FAILED",
        title: `${p.isSandbox ? "[Sandbox] " : ""}Payment ${succeeded ? "succeeded" : "failed"}: ${inv.number}`,
        link: `/finance/invoices/${inv.id}`,
        shipmentId: inv.shipmentId,
      });
    }
    await tx.execute(sql`insert into audit_log (org_id, action, entity_type, entity_id, after)
      values (${inv.issuerOrgId}, ${succeeded ? "payment.succeeded" : "payment.failed"}, 'payment', ${p.id}, ${JSON.stringify({ provider, eventId: evt.id })}::jsonb)`);
    await tx.update(webhookEvents).set({ status: "PROCESSED", processedAt: new Date() }).where(eq(webhookEvents.id, whId));
    return { duplicate: false as const, ignored: false, succeeded };
  });
}

/* ---------------------------------------------------------------- Carrier payables */

export async function listPayables(ctx: Ctx) {
  requirePerm(ctx, "finance.read");
  const rows = await ctx.db.select().from(payables).orderBy(desc(payables.createdAt)).limit(200);
  const ids = [...new Set(rows.flatMap((r) => [r.payerOrgId, r.payeeOrgId]))];
  const orgs = ids.length ? await ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, ids)) : [];
  const shipIds = [...new Set(rows.map((r) => r.shipmentId))];
  const ships = shipIds.length ? await ctx.db.select({ id: shipments.id, reference: shipments.reference, status: shipments.status }).from(shipments).where(inArray(shipments.id, shipIds)) : [];
  const pods = shipIds.length
    ? await ctx.db.select({ shipmentId: documents.shipmentId }).from(documents).where(and(inArray(documents.shipmentId, shipIds), eq(documents.category, "PROOF_OF_DELIVERY"), isNull(documents.deletedAt)))
    : [];
  return rows.map((r) => ({
    ...r,
    payerName: orgs.find((o) => o.id === r.payerOrgId)?.name ?? "",
    payeeName: orgs.find((o) => o.id === r.payeeOrgId)?.name ?? "",
    shipment: ships.find((s) => s.id === r.shipmentId) ?? null,
    podReceived: pods.some((p) => p.shipmentId === r.shipmentId),
    direction: r.payerOrgId === ctx.org.id ? "OWED_BY_US" : "OWED_TO_US",
  }));
}

export async function approvePayable(ctx: Ctx, payableId: string) {
  requirePerm(ctx, "finance.manage");
  const [p] = await ctx.db.select().from(payables).where(and(eq(payables.id, payableId), eq(payables.payerOrgId, ctx.org.id)));
  if (!p) throw notFound("Payable");
  if (p.status !== "PENDING_POD") throw conflict("Payable is not awaiting approval");
  const pod = await ctx.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.shipmentId, p.shipmentId), eq(documents.category, "PROOF_OF_DELIVERY"), isNull(documents.deletedAt)))
    .limit(1);
  if (!pod.length) throw conflict("Proof of delivery has not been received for this shipment");
  await ctx.db.update(payables).set({ status: "APPROVED", approvedBy: ctx.user.id, approvedAt: new Date(), dueAt: new Date(Date.now() + 30 * 86400_000) }).where(eq(payables.id, p.id));
  await audit(ctx, "payable.approved", "payable", p.id, { after: { amountMinor: p.amountMinor } });
}

/** Records an off-platform payment (e.g. ACH sent from the broker's bank). Vicora does not move funds. */
export async function recordPayablePaid(ctx: Ctx, payableId: string, reference: string) {
  requirePerm(ctx, "finance.manage");
  const [p] = await ctx.db.select().from(payables).where(and(eq(payables.id, payableId), eq(payables.payerOrgId, ctx.org.id)));
  if (!p) throw notFound("Payable");
  if (p.status !== "APPROVED") throw conflict("Approve the payable before recording payment");
  await ctx.db.update(payables).set({ status: "PAID", paidAt: new Date(), reference }).where(eq(payables.id, p.id));
  await enqueue(ctx.db, "notify.org", { orgId: p.payeeOrgId, type: "PAYABLE_PAID", title: `Payment recorded by ${ctx.org.name}`, body: `Reference ${reference}`, link: `/finance`, shipmentId: p.shipmentId });
  await audit(ctx, "payable.paid", "payable", p.id, { after: { reference } });
}

/* ---------------------------------------------------------------- Reporting */

export async function financeReport(ctx: Ctx) {
  requirePerm(ctx, "finance.read");
  const org = ctx.org.id;
  const [ar, ap, monthly, aging, payablesSummary] = await Promise.all([
    ctx.db.execute<{ currency: Currency; total: string; paid: string; open: string; count: number }>(sql`
      select currency, sum(total_minor)::bigint as total, sum(amount_paid_minor)::bigint as paid,
             sum(total_minor - amount_paid_minor)::bigint as open, count(*)::int as count
      from invoices where issuer_org_id = ${org} and status <> 'VOID' group by currency`),
    ctx.db.execute<{ currency: Currency; total: string; paid: string; open: string; count: number }>(sql`
      select currency, sum(total_minor)::bigint as total, sum(amount_paid_minor)::bigint as paid,
             sum(total_minor - amount_paid_minor)::bigint as open, count(*)::int as count
      from invoices where bill_to_org_id = ${org} and status <> 'VOID' group by currency`),
    ctx.db.execute<{ month: string; currency: Currency; revenue: string; cost: string }>(sql`
      select to_char(date_trunc('month', c.created_at at time zone ${ctx.org.timezone}), 'YYYY-MM') as month, c.currency,
        sum(case when c.kind = 'RECEIVABLE' and c.biller_org_id = ${org} then c.amount_minor else 0 end)::bigint as revenue,
        sum(case when c.kind = 'PAYABLE' and c.bill_to_org_id = ${org} then c.amount_minor else 0 end)::bigint as cost
      from charges c where c.status = 'CONFIRMED' and (c.biller_org_id = ${org} or c.bill_to_org_id = ${org})
      group by 1, 2 order by 1`),
    ctx.db.execute<{ bucket: string; currency: Currency; open: string }>(sql`
      select case when due_at >= now() then 'current'
                  when due_at >= now() - interval '30 days' then '1-30'
                  when due_at >= now() - interval '60 days' then '31-60'
                  else '60+' end as bucket, currency, sum(total_minor - amount_paid_minor)::bigint as open
      from invoices where issuer_org_id = ${org} and status in ('ISSUED','PARTIALLY_PAID') group by 1, 2`),
    ctx.db.execute<{ status: string; currency: Currency; amount: string; direction: string }>(sql`
      select status, currency, sum(amount_minor)::bigint as amount,
             case when payer_org_id = ${org} then 'OWED_BY_US' else 'OWED_TO_US' end as direction
      from payables where payer_org_id = ${org} or payee_org_id = ${org} group by 1, 2, 4`),
  ]);
  const num = (v: string | number | null) => Number(v ?? 0);
  return {
    receivables: ar.map((r) => ({ currency: r.currency, totalMinor: num(r.total), paidMinor: num(r.paid), openMinor: num(r.open), count: r.count })),
    payablesInvoices: ap.map((r) => ({ currency: r.currency, totalMinor: num(r.total), paidMinor: num(r.paid), openMinor: num(r.open), count: r.count })),
    monthly: monthly.map((r) => ({ month: r.month, currency: r.currency, revenueMinor: num(r.revenue), costMinor: num(r.cost), marginMinor: num(r.revenue) - num(r.cost) })),
    aging: aging.map((r) => ({ bucket: r.bucket, currency: r.currency, openMinor: num(r.open) })),
    carrierPayables: payablesSummary.map((r) => ({ status: r.status, currency: r.currency, amountMinor: num(r.amount), direction: r.direction })),
  };
}

export async function completeShipment(ctx: Ctx, shipmentId: string) {
  requirePerm(ctx, "shipment.read");
  const access = await requireParty(ctx, shipmentId);
  if (!access.isProvider) throw new AppError("FORBIDDEN", "Only the booked provider can close the shipment");
  await transitionShipment(ctx, access, "COMPLETED", { reason: "Closed by provider" });
}
