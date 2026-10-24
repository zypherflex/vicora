import type { Metadata } from "next";
import { LazyShipmentMap } from "@/components/map/lazy";
import { Badge, StatusBadge } from "@/components/ui";
import { SERVICE_TYPE_LABEL, SHIPMENT_STATUS_LABEL, type ShipmentStatus } from "@/lib/domain";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { rateLimit } from "@/server/http/rate-limit";
import { pageMeta } from "@/server/http/api";
import { publicTracking } from "@/server/services/tracking";

export const metadata: Metadata = { title: "Shipment tracking", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STEPS: ShipmentStatus[] = ["BOOKED", "DISPATCHED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];

export default async function PublicTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const meta = await pageMeta();
  let t: Awaited<ReturnType<typeof publicTracking>> = null;
  let limited = false;
  try {
    await rateLimit(`track-page:${meta.ip ?? "unknown"}`, 120, 900);
    t = await publicTracking(token);
  } catch {
    limited = true;
  }
  if (!t) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-xl font-semibold text-brand-700">Vicora</p>
        <h1 className="mt-6 text-lg font-semibold">{limited ? "Too many requests" : "Tracking link unavailable"}</h1>
        <p className="mt-2 text-sm text-slate-600">{limited ? "Please wait a few minutes and try again." : "This link is invalid, has expired, or was revoked by the sender."}</p>
      </main>
    );
  }
  const idx = STEPS.indexOf(t.status === "COMPLETED" ? "DELIVERED" : t.status === "ASSIGNED" ? "BOOKED" : (t.status as ShipmentStatus));
  const destTz = t.destination?.timezone ?? "America/Chicago";
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <header className="flex items-center justify-between">
        <span className="text-xl font-bold text-brand-700">Vicora</span>
        {t.isDemo && <Badge tone="violet">Demo shipment (fictional)</Badge>}
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          {t.reference} · {SERVICE_TYPE_LABEL[t.serviceType]}
          {t.provider && ` · handled by ${t.provider}`}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {t.origin?.city}, {t.origin?.state} → {t.destination?.city}, {t.destination?.state}
        </h1>
        <div className="mt-2">
          <StatusBadge status={t.status} label={SHIPMENT_STATUS_LABEL[t.status as ShipmentStatus]} />
        </div>
        {t.deliveredAt ? (
          <p className="mt-3 text-lg">Delivered {formatInTimeZone(t.deliveredAt, destTz)}</p>
        ) : t.etaAt ? (
          <p className="mt-3 text-lg">
            Estimated arrival <strong>{formatInTimeZone(t.etaAt, destTz)}</strong>
            <span className="block text-xs text-slate-500">Estimate based on the latest reported location; it can change.</span>
          </p>
        ) : null}
        <ol className="mt-5 grid grid-cols-5 gap-1">
          {STEPS.map((s, i) => (
            <li key={s} className="text-center">
              <div className={`h-1.5 rounded-full ${i <= idx ? "bg-brand-600" : "bg-slate-200"}`} />
              <p className={`mt-1 text-[11px] ${i <= idx ? "text-slate-800" : "text-slate-400"}`}>{SHIPMENT_STATUS_LABEL[s]}</p>
            </li>
          ))}
        </ol>
      </section>
      {t.lastLocation && (
        <section>
          <LazyShipmentMap
            height={260}
            linkBase={null}
            shipments={[{ id: "t", reference: t.reference, title: "", status: t.status, origin: null, destination: null, last: { lat: t.lastLocation.lat, lng: t.lastLocation.lng, source: t.lastLocation.source, at: new Date(t.lastLocation.recordedAt).toISOString() }, attention: false }]}
          />
          <p className="mt-1 text-xs text-slate-500">
            Approximate area (city level) as of {relativeTime(t.lastLocation.recordedAt)}
            {t.lastLocation.source === "DEMO" && " · simulated demo position"}
          </p>
        </section>
      )}
      {t.vehicles.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Vehicles</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {t.vehicles.map((v) => (
              <li key={v.vinLast6} className="flex justify-between">
                <span>
                  {v.description} <span className="text-xs text-slate-500">VIN …{v.vinLast6}</span>
                </span>
                <span className="text-xs text-slate-500">{v.status.replace("_", " ").toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Updates</h2>
        <ol className="mt-3 space-y-3">
          {t.milestones.length === 0 && <li className="text-sm text-slate-500">No updates yet.</li>}
          {t.milestones.map((m, i) => (
            <li key={i} className="text-sm">
              <p className="font-medium">{m.title}</p>
              <p className="text-xs text-slate-500">{formatInTimeZone(m.occurredAt, destTz)}</p>
            </li>
          ))}
        </ol>
      </section>
      <footer className="text-center text-xs text-slate-400">This link expires {formatInTimeZone(t.expiresAt, destTz, { dateOnly: true })}. Pricing, documents and contacts are never shown here.</footer>
    </main>
  );
}
