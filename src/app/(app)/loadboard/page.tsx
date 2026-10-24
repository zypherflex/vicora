import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DemoBadge, Empty, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { EQUIPMENT_LABEL, SERVICE_TYPE_LABEL, type EquipmentType } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { load } from "@/server/page";
import { loadBoard } from "@/server/services/quotes";

export const metadata: Metadata = { title: "Load board" };

export default async function LoadBoardPage() {
  const rows = await load((ctx) => loadBoard(ctx), { need: "loadboard.read" });
  return (
    <>
      <PageHeader title="Load board" subtitle="Open quote requests that match your services. Customer identity and contacts stay hidden until you are awarded." />
      {rows.length === 0 ? (
        <Empty title="No open requests match your services right now" />
      ) : (
        <Card pad={false}>
          <Table head={["Load", "Lane", "Pickup window", "Equipment", "Cargo", "Budget", "Your quote"]}>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/shipments/${s.id}`} className="font-medium text-brand-700 hover:underline">
                    {s.reference}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {SERVICE_TYPE_LABEL[s.serviceType]} · posted {relativeTime(s.updatedAt)} {s.quoteVisibility === "INVITED" && <Badge tone="blue">Invited</Badge>} {s.isDemo && <DemoBadge label="Demo" />}
                  </p>
                </Td>
                <Td>
                  {s.origin?.city}, {s.origin?.state} → {s.destination?.city}, {s.destination?.state}
                </Td>
                <Td className="text-xs">{s.origin ? formatInTimeZone(s.origin.windowStart, s.origin.timezone) : "—"}</Td>
                <Td>{s.equipmentType ? EQUIPMENT_LABEL[s.equipmentType as EquipmentType] : "Any"}</Td>
                <Td>{s.vehicleCount ? `${s.vehicleCount} vehicle${s.vehicleCount > 1 ? "s" : ""}` : s.totalWeightLb ? `${s.totalWeightLb.toLocaleString()} lb` : "—"}</Td>
                <Td>{s.targetBudgetMinor != null ? formatMoney(s.targetBudgetMinor, s.currency) : "—"}</Td>
                <Td>
                  {s.myQuote ? (
                    <span className="flex items-center gap-2">
                      {formatMoney(s.myQuote.totalMinor, s.myQuote.currency)} <StatusBadge status={s.myQuote.status} />
                    </span>
                  ) : (
                    <Link href={`/shipments/${s.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                      Quote →
                    </Link>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
