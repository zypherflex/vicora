"use client";

import dynamic from "next/dynamic";

/** Leaflet touches window on import, so the map only renders client-side. */
export const LazyShipmentMap = dynamic(() => import("./shipment-map"), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-slate-100" />,
});
export type { MapShipment } from "./shipment-map";
