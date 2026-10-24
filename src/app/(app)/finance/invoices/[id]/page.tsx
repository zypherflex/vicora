import type { Metadata } from "next";
import Link from "next/link";
import { Card, DemoBadge, KV, StatusBadge, Table, Td } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { getInvoice } from "@/server/services/finance";
import { AutoRefresh, CreditForm, PayInvoice } from "../../forms";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { inv, tz, canPay, canManage } = await load(
    async (ctx) => ({ inv: await getInvoice(ctx, id), tz: ctx.org.timezone, canPay: ctx.perms.has("payment.make"), canManage: ctx.perms.has("finance.manage") }),
    { need: "finance.read" },
  );
  const i = inv.invoice;
  const open = ["ISSUED", "PARTIALLY_PAID"].includes(i.status);
  const processing = inv.payments.some((p) => p.status === "PENDING");
  return (
    <>
      <AutoRefresh active={processing} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Invoice {i.number}</h1>
        <StatusBadge status={i.status} />
        {i.isDemo && <DemoBadge />}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <KV
              items={[
                ["From", inv.issuer.name],
                ["Bill to", inv.billTo.name],
                ["Shipment", inv.shipment ? <Link key="s" className="text-brand-600 hover:underline" href={`/shipments/${i.shipmentId}?tab=finance`}>{inv.shipment.reference}</Link> : null],
                ["Issued", formatInTimeZone(i.issuedAt, tz, { dateOnly: true })],
                ["Due", formatInTimeZone(i.dueAt, tz, { dateOnly: true })],
                ["Memo", i.memo],
              ]}
            />
          </Card>
          <Card pad={false}>
            <Table head={["Description", "Qty", "Unit", "Amount"]}>
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <Td>
                    {l.description} <span className="text-xs text-slate-500">{l.code}</span>
                  </Td>
                  <Td>{(l.quantityMilli / 1000).toString()}</Td>
                  <Td>{formatMoney(l.unitAmountMinor, i.currency)}</Td>
                  <Td>{formatMoney(l.amountMinor, i.currency)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="font-medium">Subtotal</Td>
                <Td />
                <Td />
                <Td>{formatMoney(i.subtotalMinor, i.currency)}</Td>
              </tr>
              {inv.credits.map((c) => (
                <tr key={c.id}>
                  <Td className="text-slate-600">Credit: {c.reason}</Td>
                  <Td />
                  <Td />
                  <Td>−{formatMoney(c.amountMinor, c.currency)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="font-semibold">Total</Td>
                <Td />
                <Td />
                <Td className="font-semibold">{formatMoney(i.totalMinor, i.currency)}</Td>
              </tr>
              <tr>
                <Td className="font-semibold">Balance due</Td>
                <Td />
                <Td />
                <Td className="font-semibold">{formatMoney(i.balanceMinor, i.currency)}</Td>
              </tr>
            </Table>
          </Card>
          {inv.payments.length > 0 && (
            <Card title="Payments" pad={false}>
              <Table head={["When", "Amount", "Provider", "Status"]}>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <Td>{formatInTimeZone(p.createdAt, tz)}</Td>
                    <Td>{formatMoney(p.amountMinor, p.currency)}</Td>
                    <Td>
                      {p.provider}
                      {p.isSandbox && <span className="ml-1 text-xs text-violet-700">sandbox</span>}
                    </Td>
                    <Td>
                      <StatusBadge status={p.status === "SUCCEEDED" ? "PAID" : p.status === "FAILED" ? "REJECTED" : "PENDING"} label={p.status.toLowerCase()} />
                      {p.failureReason && <p className="text-xs text-red-600">{p.failureReason}</p>}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {inv.isPayer && open && canPay && !processing && (
            <Card title="Pay this invoice">
              <PayInvoice invoiceId={i.id} amountLabel={formatMoney(i.balanceMinor, i.currency)} />
            </Card>
          )}
          {processing && (
            <Card title="Processing">
              <p className="text-sm text-slate-600">Waiting for the payment processor&apos;s signed webhook. This page refreshes automatically.</p>
            </Card>
          )}
          {inv.isIssuer && open && canManage && (
            <Card title="Credit note">
              <CreditForm invoiceId={i.id} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
