import Link from "next/link";
import { SERVICE_TYPE_LABEL, SHIPMENT_STATUS_LABEL, type ServiceType, type ShipmentStatus } from "@/lib/domain";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { Badge, DemoBadge, Empty, StatusBadge, Table, Td } from "@/components/ui";
import type { listShipments } from "@/server/services/shipments";

type Row = Awaited<ReturnType<typeof listShipments>>[number];

export function ShipmentTable({ rows, tz }: { rows: Row[]; tz: string }) {
  if (!rows.length) return <Empty title="No shipments match">Adjust the filters or book a new shipment.</Empty>;
  return (
    <Table head={["Reference", "Route", "Service", "Status", "Parties", "Pickup", "Last update", ""]}>
      {rows.map((s) => (
        <tr key={s.id} className="hover:bg-slate-50">
          <Td>
            <Link href={`/shipments/${s.id}`} className="font-medium text-brand-700 hover:underline">
              {s.reference}
            </Link>
            <p className="max-w-[14rem] truncate text-xs text-slate-500">{s.title}</p>
          </Td>
          <Td>
            <p>{s.origin ? `${s.origin.city}, ${s.origin.state}` : "—"}</p>
            <p className="text-xs text-slate-500">→ {s.destination ? `${s.destination.city}, ${s.destination.state}` : "—"}</p>
          </Td>
          <Td>{SERVICE_TYPE_LABEL[s.serviceType as ServiceType]}</Td>
          <Td>
            <StatusBadge status={s.status} label={SHIPMENT_STATUS_LABEL[s.status as ShipmentStatus]} />
            {s.openExceptions > 0 && (
              <span className="ml-1">
                <Badge tone="red">{s.openExceptions} exception{s.openExceptions > 1 ? "s" : ""}</Badge>
              </span>
            )}
          </Td>
          <Td className="text-xs text-slate-600">
            <p>{s.isCustomer ? "Your shipment" : s.customerName}</p>
            {s.providerName && <p>Provider: {s.providerName}</p>}
            {s.executorNames.length > 0 && <p>Carrier: {s.executorNames.join(", ")}</p>}
          </Td>
          <Td className="text-xs">{s.origin?.windowStart ? formatInTimeZone(s.origin.windowStart, s.origin.timezone ?? tz) : "—"}</Td>
          <Td className="text-xs text-slate-500">
            {relativeTime(s.updatedAt)}
            {s.lastPing && <p>ping {relativeTime(s.lastPing.recordedAt)}{s.lastPing.source === "DEMO" ? " (demo)" : ""}</p>}
          </Td>
          <Td>{s.isDemo && <DemoBadge label="Demo" />}</Td>
        </tr>
      ))}
    </Table>
  );
}
