import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, Phone } from "lucide-react";
import { LiveShare } from "@/components/driver/live-share";
import { Badge, Card, StatusBadge } from "@/components/ui";
import { categoryLabel, LEG_STATUS_LABEL, type LegStatus } from "@/lib/domain";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { driverTrips } from "@/server/services/fleet";
import { getShipmentTwin } from "@/server/services/shipments";
import { LocationReporter, MilestoneForm, UploadForm } from "../../shipments/[id]/forms";
import { InspectLauncher } from "./inspect";

export const metadata: Metadata = { title: "Load" };

export default async function DriverLoad({ params }: { params: Promise<{ shipmentId: string }> }) {
  const { shipmentId } = await params;
  const { trip, twin } = await load(async (ctx) => {
    const trips = await driverTrips(ctx);
    const trip = trips.find((t) => t.shipment.id === shipmentId);
    if (!trip) return { trip: null, twin: null };
    return { trip, twin: await getShipmentTwin(ctx, shipmentId) };
  });
  if (!trip || !twin) notFound();
  const { leg, shipment, from, to } = trip;
  const stops = [from, to].filter(Boolean) as NonNullable<typeof from>[];
  const active = !["DELIVERED", "CANCELLED"].includes(leg.status);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{shipment.reference}</h1>
          <StatusBadge status="IN_TRANSIT" label={LEG_STATUS_LABEL[leg.status]} />
          {shipment.isDemo && <Badge tone="violet">Demo</Badge>}
        </div>
        <p className="text-sm text-slate-600">{shipment.title}</p>
      </div>

      {stops.map((st, i) => (
        <Card key={st.id} title={i === 0 ? "Pickup" : "Delivery"}>
          <p className="font-medium">{st.name}</p>
          <p className="text-sm text-slate-600">
            {st.address1 ? `${st.address1}, ` : ""}
            {st.city}, {st.state} {st.postalCode}
          </p>
          <p className="text-sm text-slate-500">
            {formatInTimeZone(st.windowStart, st.timezone)} – {formatInTimeZone(st.windowEnd, st.timezone)}
          </p>
          {st.reference && <p className="text-sm">Ref: {st.reference}</p>}
          {st.notes && <p className="text-sm text-amber-800">{st.notes}</p>}
          <div className="mt-3 flex gap-2">
            <a className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-300 py-2 text-sm" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([st.address1, st.city, st.state, st.postalCode].filter(Boolean).join(", "))}`} target="_blank" rel="noreferrer">
              <MapPin className="h-4 w-4" /> Navigate
            </a>
            {st.contactPhone && (
              <a className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-300 py-2 text-sm" href={`tel:${st.contactPhone.replace(/[^\d+]/g, "")}`}>
                <Phone className="h-4 w-4" /> {st.contactName ?? "Call"}
              </a>
            )}
          </div>
        </Card>
      ))}

      {shipment.specialInstructions && <Card title="Instructions"><p className="text-sm">{shipment.specialInstructions}</p></Card>}

      {active && (
        <Card title="Update status">
          <MilestoneForm shipmentId={shipment.id} legId={leg.id} status={leg.status as LegStatus} compact />
        </Card>
      )}

      {active && (
        <Card title="Location">
          <div className="space-y-3">
            <LiveShare shipmentId={shipment.id} legId={leg.id} />
            <LocationReporter shipmentId={shipment.id} legId={leg.id} />
          </div>
        </Card>
      )}

      {twin.vehicles.length > 0 && (
        <Card title="Vehicles">
          <ul className="space-y-4">
            {twin.vehicles.map((v) => {
              const label = `${v.year} ${v.make} ${v.model}`;
              const done = (k: string) => twin.inspections.some((i) => i.vehicleId === v.id && i.kind === k);
              return (
                <li key={v.id} className="border-b border-slate-100 pb-3 last:border-0">
                  <p className="font-medium">
                    {label} {v.color && <span className="text-sm text-slate-500">· {v.color}</span>}
                  </p>
                  <p className="font-mono text-xs text-slate-500">{v.vin}</p>
                  <p className="text-xs text-slate-500">
                    {v.operable ? "Runs and drives" : "Inoperable: needs winch"} · {v.transportType.toLowerCase()}
                    {v.auctionReference && ` · lot ${v.auctionReference}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {done("PICKUP") ? <Badge tone="green">Pickup report done</Badge> : <InspectLauncher shipmentId={shipment.id} vehicle={{ id: v.id, label }} kind="PICKUP" />}
                    {done("PICKUP") && (done("DELIVERY") ? <Badge tone="green">Delivery report done</Badge> : <InspectLauncher shipmentId={shipment.id} vehicle={{ id: v.id, label }} kind="DELIVERY" />)}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Paperwork">
        <ul className="mb-3 space-y-1 text-sm">
          {twin.documents.length === 0 && <li className="text-slate-500">No documents yet.</li>}
          {twin.documents.slice(0, 12).map((d) => (
            <li key={d.id} className="flex justify-between">
              <span>{d.title}</span>
              <span className="text-xs text-slate-500">{categoryLabel(d.category)}</span>
            </li>
          ))}
        </ul>
        <UploadForm shipmentId={shipment.id} canInternal={false} defaultCategory={twin.vehicles.length ? "VEHICLE_PHOTO" : "BILL_OF_LADING"} />
      </Card>
    </div>
  );
}
