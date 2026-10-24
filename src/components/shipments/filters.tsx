"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SERVICE_TYPES, SERVICE_TYPE_LABEL, SHIPMENT_STATUSES, SHIPMENT_STATUS_LABEL } from "@/lib/domain";
import { api } from "@/lib/client/api";
import { buttonClass, cx } from "@/components/ui";

const KEYS = ["q", "status", "serviceType", "attention"] as const;

export function ShipmentFilters({ base, views }: { base: string; views: { id: string; name: string; filters: Record<string, string> }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [saving, setSaving] = useState(false);
  const current = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""]).filter(([, v]) => v));
  const go = (f: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    const view = sp.get("view");
    if (view) p.set("view", view);
    router.push(`${base}?${p.toString()}`);
  };
  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          go(Object.fromEntries(KEYS.map((k) => [k, (f.get(k) as string) ?? ""])));
        }}
      >
        <input name="q" defaultValue={current.q} placeholder="Reference, city, VIN, container…" className="field w-64" aria-label="Search shipments" />
        <select name="status" defaultValue={current.status} className="field w-44" aria-label="Status">
          <option value="">Any status</option>
          {SHIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SHIPMENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="serviceType" defaultValue={current.serviceType} className="field w-44" aria-label="Service">
          <option value="">Any service</option>
          {SERVICE_TYPES.map((s) => (
            <option key={s} value={s}>
              {SERVICE_TYPE_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" name="attention" value="1" defaultChecked={current.attention === "1"} /> Needs attention
        </label>
        <button className={buttonClass("primary")}>Apply</button>
        {Object.keys(current).length > 0 && (
          <button
            type="button"
            className={buttonClass("ghost")}
            onClick={async () => {
              const name = window.prompt("Name this view");
              if (!name) return;
              setSaving(true);
              try {
                await api("/views", { body: { name, filters: current } });
                router.refresh();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save view"}
          </button>
        )}
      </form>
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">Saved views:</span>
          {views.map((v) => {
            const on = JSON.stringify(v.filters) === JSON.stringify(current);
            return (
              <span key={v.id} className={cx("inline-flex items-center rounded-full border", on ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white")}>
                <button className="px-2 py-0.5" onClick={() => go(v.filters)}>
                  {v.name}
                </button>
                <button
                  className="pr-2 text-slate-400 hover:text-red-600"
                  aria-label={`Delete view ${v.name}`}
                  onClick={async () => {
                    await api(`/views/${v.id}`, { method: "DELETE" });
                    router.refresh();
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
