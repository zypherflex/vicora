import type { MapShipment } from "@/components/map/shipment-map";

type Stop = { lat: number | null; lng: number | null; city: string; state: string } | null | undefined;
export function toMapShipment(s: { id: string; reference: string; title: string; status: string; origin?: Stop; destination?: Stop; lastPing?: { lat: number; lng: number; source: string; recordedAt: Date } | null; openExceptions?: number }): MapShipment {
  const pick = (x: Stop) => (x ? { lat: x.lat, lng: x.lng, city: x.city, state: x.state } : null);
  return {
    id: s.id,
    reference: s.reference,
    title: s.title,
    status: s.status,
    origin: pick(s.origin),
    destination: pick(s.destination),
    last: s.lastPing ? { lat: s.lastPing.lat, lng: s.lastPing.lng, source: s.lastPing.source, at: s.lastPing.recordedAt.toISOString() } : null,
    attention: (s.openExceptions ?? 0) > 0,
  };
}
