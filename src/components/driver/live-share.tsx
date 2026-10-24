"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { relativeTime } from "@/lib/time";
import { Badge, cx } from "@/components/ui";

const INTERVAL_MS = 5 * 60_000;

/**
 * Shares GPS while this screen stays open, at most once every 5 minutes.
 * Browsers stop location updates in the background; a native app would be needed for that.
 */
export function LiveShare({ shipmentId, legId }: { shipmentId: string; legId: string }) {
  const [on, setOn] = useState(false);
  const [last, setLast] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastSent = useRef(0);
  useEffect(() => {
    if (!on) return;
    if (!("geolocation" in navigator)) {
      setErr("Location is not available on this device.");
      setOn(false);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastSent.current < INTERVAL_MS) return;
        lastSent.current = Date.now();
        api(`/shipments/${shipmentId}/location`, { body: { legId, lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), source: "LIVE_GPS" } })
          .then(() => {
            setLast(new Date());
            setErr(null);
          })
          .catch((e) => setErr(e.message));
      },
      (e) => {
        setErr(e.code === 1 ? "Location permission denied. Use manual location instead." : "Waiting for GPS signal…");
        if (e.code === 1) setOn(false);
      },
      { enableHighAccuracy: true, maximumAge: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on, shipmentId, legId]);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => setOn((x) => !x)} className={cx("rounded-full px-3 py-1.5 text-sm font-medium", on ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700")}>
        {on ? "Sharing location" : "Share location while open"}
      </button>
      {on && <Badge tone="green">Live GPS{last ? ` · sent ${relativeTime(last)}` : ""}</Badge>}
      {err && <span className="text-xs text-amber-700">{err}</span>}
    </div>
  );
}
