import type { Metadata } from "next";
import Link from "next/link";
import { Card, Empty, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { relativeTime } from "@/lib/time";
import { load } from "@/server/page";
import { listTenders } from "@/server/services/operations";
import { TenderResponse } from "../shipments/[id]/forms";

export const metadata: Metadata = { title: "Tenders" };

export default async function TendersPage() {
  const { rows, canRespond } = await load(async (ctx) => ({ rows: await listTenders(ctx), canRespond: ctx.perms.has("tender.respond") }));
  const incoming = rows.filter((t) => t.incoming);
  const outgoing = rows.filter((t) => !t.incoming);
  const section = (title: string, list: typeof rows, showRespond: boolean) => (
    <Card title={title} pad={false}>
      {list.length === 0 ? (
        <div className="p-4">
          <Empty title="None" />
        </div>
      ) : (
        <Table head={["Shipment", "Lane", showRespond ? "From" : "To", "Rate", "Status", ""]}>
          {list.map((t) => (
            <tr key={t.id}>
              <Td>
                <Link href={`/shipments/${t.shipmentId}?tab=dispatch`} className="font-medium text-brand-700 hover:underline">
                  View load
                </Link>
                <p className="text-xs text-slate-500">sent {relativeTime(t.createdAt)}</p>
              </Td>
              <Td>
                {t.from?.city}, {t.from?.state} → {t.to?.city}, {t.to?.state}
              </Td>
              <Td>{showRespond ? t.fromOrgName : t.toOrgName}</Td>
              <Td>{formatMoney(t.rateMinor, t.currency)}</Td>
              <Td>
                <StatusBadge status={t.status} />
                {t.status === "OFFERED" && t.expiresAt && <p className="text-xs text-slate-500">expires {relativeTime(t.expiresAt)}</p>}
              </Td>
              <Td>{showRespond && canRespond && t.status === "OFFERED" && <TenderResponse tenderId={t.id} />}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader title="Tenders" subtitle="Load offers between brokers and carriers." />
      <div className="space-y-6">
        {(incoming.length > 0 || canRespond) && section("Offered to you", incoming, true)}
        {outgoing.length > 0 && section("Sent by you", outgoing, false)}
      </div>
    </>
  );
}
