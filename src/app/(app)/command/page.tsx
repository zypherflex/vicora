import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LazyShipmentMap } from "@/components/map/lazy";
import { AttentionList } from "@/components/shipments/attention-list";
import { ShipmentFilters } from "@/components/shipments/filters";
import { ShipmentTable } from "@/components/shipments/shipment-table";
import { toMapShipment } from "@/components/shipments/to-map";
import { ButtonLink, Card, cx, PageHeader } from "@/components/ui";
import { ACTIVE_STATUSES, SHIPMENT_STATUSES, SERVICE_TYPES, type ShipmentStatus } from "@/lib/domain";
import { can } from "@/server/authz/context";
import { load } from "@/server/page";
import { attentionFor } from "@/server/services/attention";
import { listSavedViews } from "@/server/services/comms";
import { listShipments } from "@/server/services/shipments";

export const metadata: Metadata = { title: "Command center" };

type SP = { q?: string; status?: string; serviceType?: string; attention?: string; view?: string; panel?: string };

export default async function CommandCenter({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status = SHIPMENT_STATUSES.includes(sp.status as ShipmentStatus) ? (sp.status as ShipmentStatus) : undefined;
  const serviceType = SERVICE_TYPES.includes(sp.serviceType as never) ? sp.serviceType : undefined;
  const { rows, attention, views, tz, canBook } = await load(async (ctx) => {
    if (ctx.roles.every((r) => r === "DRIVER")) redirect("/driver");
    const [rows, attention, views] = await Promise.all([listShipments(ctx, { q: sp.q?.slice(0, 100), status, serviceType, limit: 200 }), attentionFor(ctx), listSavedViews(ctx)]);
    return { rows, attention, views, tz: ctx.org.timezone, canBook: can(ctx, "shipment.create") };
  });
  const flagged = new Set(attention.map((a) => a.shipmentId).filter(Boolean));
  const shown = sp.attention === "1" ? rows.filter((r) => r.openExceptions > 0 || flagged.has(r.id)) : rows;
  const view = sp.view === "map" ? "map" : "list";
  const kpis = [
    { label: "Active", value: rows.filter((r) => ACTIVE_STATUSES.includes(r.status as ShipmentStatus)).length },
    { label: "Awaiting quotes", value: rows.filter((r) => r.status === "QUOTE_REQUESTED").length },
    { label: "Delivered, not closed", value: rows.filter((r) => r.status === "DELIVERED").length },
    { label: "Needs attention", value: attention.length, alert: attention.some((a) => a.severity === "critical" || a.severity === "high") },
  ];
  const qs = (v: string) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([k, x]) => k !== "view" && x) as [string, string][]);
    p.set("view", v);
    return `/command?${p}`;
  };

  return (
    <>
      <PageHeader title="Command center" subtitle="Exceptions first, then everything in motion." actions={canBook && <ButtonLink href="/shipments/new">Book a shipment</ButtonLink>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">{k.label}</p>
            <p className={cx("mt-1 text-2xl font-semibold", k.alert ? "text-red-600" : "text-slate-900")}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <ShipmentFilters base="/command" views={views.map((v) => ({ id: v.id, name: v.name, filters: v.filters as Record<string, string> }))} />
          <div className="flex gap-1 text-sm">
            {(["list", "map"] as const).map((v) => (
              <Link key={v} href={qs(v)} className={cx("rounded-md px-3 py-1.5 font-medium", view === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}>
                {v === "list" ? "List" : "Map"}
              </Link>
            ))}
            <span className="ml-auto self-center text-xs text-slate-500">{shown.length} shipments</span>
          </div>
          {view === "map" ? (
            <>
              <LazyShipmentMap shipments={shown.map(toMapShipment)} height={520} />
              <p className="text-xs text-slate-500">Large dots are the latest reported location; red marks shipments with open exceptions. Positions from the demo simulator are labeled in each popup.</p>
            </>
          ) : (
            <Card pad={false}>
              <ShipmentTable rows={shown} tz={tz} />
            </Card>
          )}
        </div>
        <Card title={`Needs attention (${attention.length})`}>
          <AttentionList items={attention} limit={sp.panel === "attention" ? undefined : 8} />
        </Card>
      </div>
    </>
  );
}
