import type { Metadata } from "next";
import { ShipmentFilters } from "@/components/shipments/filters";
import { ShipmentTable } from "@/components/shipments/shipment-table";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { SERVICE_TYPES, SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/domain";
import { can } from "@/server/authz/context";
import { load } from "@/server/page";
import { listSavedViews } from "@/server/services/comms";
import { listShipments } from "@/server/services/shipments";

export const metadata: Metadata = { title: "Shipments" };

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; serviceType?: string; attention?: string }> }) {
  const sp = await searchParams;
  const status = SHIPMENT_STATUSES.includes(sp.status as ShipmentStatus) ? (sp.status as ShipmentStatus) : undefined;
  const serviceType = SERVICE_TYPES.includes(sp.serviceType as never) ? sp.serviceType : undefined;
  const data = await load(async (ctx) => ({
    rows: await listShipments(ctx, { q: sp.q?.slice(0, 100), status, serviceType, limit: 200 }),
    views: await listSavedViews(ctx),
    tz: ctx.org.timezone,
    canBook: can(ctx, "shipment.create"),
  }));
  const rows = sp.attention === "1" ? data.rows.filter((r) => r.openExceptions > 0) : data.rows;
  return (
    <>
      <PageHeader title="Shipments" subtitle="Every shipment your organization is a party to." actions={data.canBook && <ButtonLink href="/shipments/new">Book a shipment</ButtonLink>} />
      <div className="mb-4">
        <ShipmentFilters base="/shipments" views={data.views.map((v) => ({ id: v.id, name: v.name, filters: v.filters as Record<string, string> }))} />
      </div>
      <Card pad={false}>
        <ShipmentTable rows={rows} tz={data.tz} />
      </Card>
    </>
  );
}
