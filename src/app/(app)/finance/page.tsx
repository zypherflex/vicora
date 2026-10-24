import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, DemoBadge, Empty, PageHeader, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { formatBps, formatMoney, margin } from "@/lib/money";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { financeReport, listInvoices, listPayables } from "@/server/services/finance";
import { PayablePaid } from "./forms";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "invoices";
  const d = await load(
    async (ctx) => ({
      invoices: await listInvoices(ctx),
      payables: await listPayables(ctx),
      report: ctx.perms.has("report.read") ? await financeReport(ctx) : null,
      tz: ctx.org.timezone,
      canManage: ctx.perms.has("finance.manage"),
      seeMargin: ctx.perms.has("margin.view"),
    }),
    { need: "finance.read" },
  );
  const tabs = [
    { key: "invoices", label: "Invoices", count: d.invoices.length },
    { key: "payables", label: "Carrier payables", count: d.payables.length },
    ...(d.report ? [{ key: "report", label: "Report" }] : []),
  ];
  return (
    <>
      <PageHeader title="Finance" subtitle="Amounts are stored as integer minor units (cents). Payments run in sandbox mode." />
      <Tabs base="/finance" current={tab} tabs={tabs} />

      {tab === "invoices" &&
        (d.invoices.length === 0 ? (
          <Empty title="No invoices yet">Invoices are created from confirmed charges on a shipment.</Empty>
        ) : (
          <Card pad={false}>
            <Table head={["Invoice", "Direction", "Counterparty", "Total", "Balance", "Due", "Status"]}>
              {d.invoices.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link href={`/finance/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline">
                      {i.number}
                    </Link>{" "}
                    {i.isDemo && <DemoBadge label="Demo" />}
                  </Td>
                  <Td>{i.direction === "RECEIVABLE" ? <Badge tone="green">You billed</Badge> : <Badge tone="amber">You owe</Badge>}</Td>
                  <Td>{i.direction === "RECEIVABLE" ? i.billToName : i.issuerName}</Td>
                  <Td>{formatMoney(i.totalMinor, i.currency)}</Td>
                  <Td>{formatMoney(i.balanceMinor, i.currency)}</Td>
                  <Td>{formatInTimeZone(i.dueAt, d.tz, { dateOnly: true })}</Td>
                  <Td>
                    <StatusBadge status={i.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}

      {tab === "payables" &&
        (d.payables.length === 0 ? (
          <Empty title="No carrier payables">Payables are created when a brokered shipment is completed.</Empty>
        ) : (
          <Card pad={false}>
            <Table head={["Shipment", "Payer → payee", "Amount", "POD", "Status", ""]}>
              {d.payables.map((p) => (
                <tr key={p.id}>
                  <Td>
                    {p.shipment ? (
                      <Link href={`/shipments/${p.shipmentId}?tab=finance`} className="text-brand-700 hover:underline">
                        {p.shipment.reference}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    {p.payerName} → {p.payeeName}
                  </Td>
                  <Td>{formatMoney(p.amountMinor, p.currency)}</Td>
                  <Td>{p.podReceived ? <Badge tone="green">Received</Badge> : <Badge tone="amber">Missing</Badge>}</Td>
                  <Td>
                    <StatusBadge status={p.status === "PENDING_POD" ? "PENDING" : p.status} label={p.status.replace("_", " ").toLowerCase()} />
                    {p.reference && <p className="text-xs text-slate-500">Ref {p.reference}</p>}
                  </Td>
                  <Td>
                    {d.canManage && p.direction === "OWED_BY_US" && p.status === "PENDING_POD" && (
                      <ActionButton path={`/payables/${p.id}/approve`} variant="primary" disabled={!p.podReceived}>
                        Approve
                      </ActionButton>
                    )}
                    {d.canManage && p.direction === "OWED_BY_US" && p.status === "APPROVED" && <PayablePaid id={p.id} />}
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="border-t border-slate-100 p-3 text-xs text-slate-500">Vicora tracks carrier payables; funds move through your own bank. Recording a payment notifies the carrier.</p>
          </Card>
        ))}

      {tab === "report" && d.report && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {d.report.receivables.map((r) => (
              <div key={`ar-${r.currency}`} className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">Receivables open ({r.currency})</p>
                <p className="mt-1 text-2xl font-semibold">{formatMoney(r.openMinor, r.currency)}</p>
                <p className="text-xs text-slate-500">
                  {r.count} invoices · {formatMoney(r.paidMinor, r.currency)} collected
                </p>
              </div>
            ))}
            {d.report.payablesInvoices.map((r) => (
              <div key={`ap-${r.currency}`} className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">Invoices you owe ({r.currency})</p>
                <p className="mt-1 text-2xl font-semibold">{formatMoney(r.openMinor, r.currency)}</p>
                <p className="text-xs text-slate-500">{r.count} invoices</p>
              </div>
            ))}
          </div>
          <Card title="Monthly revenue, cost and margin (confirmed charges)" pad={false}>
            {d.report.monthly.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No confirmed charges yet.</div>
            ) : (
              <Table head={["Month", "Revenue", "Cost", ...(d.seeMargin ? ["Margin", "Margin %"] : [])]}>
                {d.report.monthly.map((m) => (
                  <tr key={`${m.month}-${m.currency}`}>
                    <Td>
                      {m.month} <span className="text-xs text-slate-500">{m.currency}</span>
                    </Td>
                    <Td>{formatMoney(m.revenueMinor, m.currency)}</Td>
                    <Td>{formatMoney(m.costMinor, m.currency)}</Td>
                    {d.seeMargin && <Td>{formatMoney(m.marginMinor, m.currency)}</Td>}
                    {d.seeMargin && <Td>{formatBps(margin(m.revenueMinor, m.costMinor).bps)}</Td>}
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card title="Receivables aging" pad={false}>
            <Table head={["Bucket", "Open"]}>
              {["current", "1-30", "31-60", "60+"].map((b) => {
                const rows = d.report!.aging.filter((a) => a.bucket === b);
                return (
                  <tr key={b}>
                    <Td>{b === "current" ? "Not yet due" : `${b} days past due`}</Td>
                    <Td>{rows.length ? rows.map((r) => formatMoney(r.openMinor, r.currency)).join(" · ") : "—"}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
