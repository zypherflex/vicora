"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";

export interface MapShipment {
  id: string;
  reference: string;
  title: string;
  status: string;
  origin: { lat: number | null; lng: number | null; city: string; state: string } | null;
  destination: { lat: number | null; lng: number | null; city: string; state: string } | null;
  last: { lat: number; lng: number; source: string; at: string } | null;
  attention: boolean;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ?? "&copy; OpenStreetMap contributors";

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    const pts = JSON.parse(key) as [number, number][];
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 7 });
  }, [map, key]);
  return null;
}

export default function ShipmentMap({ shipments, height = 420, linkBase = "/shipments" }: { shipments: MapShipment[]; height?: number; linkBase?: string | null }) {
  const pts: [number, number][] = [];
  for (const s of shipments) {
    if (s.origin?.lat != null && s.origin.lng != null) pts.push([s.origin.lat, s.origin.lng]);
    if (s.destination?.lat != null && s.destination.lng != null) pts.push([s.destination.lat, s.destination.lng]);
    if (s.last) pts.push([s.last.lat, s.last.lng]);
  }
  return (
    <div style={{ height }} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <MapContainer center={[39.5, -96]} zoom={4} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        {TILE_URL !== "none" && <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />}
        <Fit points={pts} />
        {shipments.map((s) => {
          const o = s.origin?.lat != null && s.origin.lng != null ? ([s.origin.lat, s.origin.lng] as [number, number]) : null;
          const d = s.destination?.lat != null && s.destination.lng != null ? ([s.destination.lat, s.destination.lng] as [number, number]) : null;
          const color = s.attention ? "#dc2626" : "#1f57d0";
          return (
            <span key={s.id}>
              {o && d && <Polyline positions={[o, ...(s.last ? [[s.last.lat, s.last.lng] as [number, number]] : []), d]} pathOptions={{ color, weight: 2, opacity: 0.5, dashArray: "4 6" }} />}
              {o && <CircleMarker center={o} radius={4} pathOptions={{ color: "#64748b", fillOpacity: 1 }}><Tooltip>{s.reference} origin: {s.origin!.city}, {s.origin!.state}</Tooltip></CircleMarker>}
              {d && <CircleMarker center={d} radius={4} pathOptions={{ color: "#0f172a", fillOpacity: 1 }}><Tooltip>{s.reference} destination: {s.destination!.city}, {s.destination!.state}</Tooltip></CircleMarker>}
              {s.last && (
                <CircleMarker center={[s.last.lat, s.last.lng]} radius={8} pathOptions={{ color, fillColor: color, fillOpacity: 0.85 }}>
                  <Popup>
                    <strong>{s.reference}</strong>
                    <br />
                    {s.title}
                    <br />
                    Last location: {s.last.source === "DEMO" ? "demo simulation" : s.last.source === "MANUAL" ? "manually reported" : "device GPS"}
                    <br />
                    {linkBase && <Link href={`${linkBase}/${s.id}`}>Open shipment</Link>}
                  </Popup>
                </CircleMarker>
              )}
            </span>
          );
        })}
      </MapContainer>
      {TILE_URL === "none" && <p className="absolute bottom-2 left-2 z-[400] rounded bg-white/90 px-2 py-1 text-xs text-slate-500">Map tiles disabled (NEXT_PUBLIC_MAP_TILE_URL=none)</p>}
    </div>
  );
}
