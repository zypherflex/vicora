import type { Metadata } from "next";
import Link from "next/link";
import { Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { LEG_STATUS_LABEL } from "@/lib/domain";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { driverTrips } from "@/server/services/fleet";

export const metadata: Metadata = { title: "My loads" };

export default async function DriverHome() {
  const { trips, isDriver } = await load(async (ctx) => ({ trips: await driverTrips(ctx), isDriver: ctx.roles.includes("DRIVER") }), { need: "milestone.record" });
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="My loads" subtitle="Tap a load to record milestones, photos and proof of delivery." />
      {!isDriver && <Notice tone="amber">This view lists loads assigned to you as a driver. Dispatchers record milestones from each shipment&apos;s Dispatch tab.</Notice>}
      {trips.length === 0 ? (
        <div className="mt-4">
          <Empty title="No loads assigned to you" />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {trips.map(({ leg, shipment, from, to, vehicles }) => (
            <li key={leg.id}>
              <Link href={`/driver/${shipment.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{shipment.reference}</span>
                  <StatusBadge status={leg.status === "DELIVERED" ? "DELIVERED" : "IN_TRANSIT"} label={LEG_STATUS_LABEL[leg.status]} />
                </div>
                <p className="mt-2 text-lg font-medium">
                  {from?.city}, {from?.state} → {to?.city}, {to?.state}
                </p>
                <p className="text-sm text-slate-500">Pickup {from ? formatInTimeZone(from.windowStart, from.timezone) : "—"}</p>
                <p className="text-sm text-slate-500">Deliver {to ? formatInTimeZone(to.windowStart, to.timezone) : "—"}</p>
                {vehicles.length > 0 && <p className="mt-1 text-sm text-slate-600">{vehicles.length} vehicle{vehicles.length > 1 ? "s" : ""}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
