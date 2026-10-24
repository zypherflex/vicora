"use client";

import { useState } from "react";
import { EQUIPMENT_LABEL, EQUIPMENT_TYPES, US_STATES } from "@/lib/domain";
import { api } from "@/lib/client/api";
import { buttonClass } from "@/components/ui";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

const s = (v: FormDataEntryValue | null) => ((v as string)?.trim() ? (v as string).trim() : null);

export function DriverForm() {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api("/fleet/drivers", { body: { name: s(f.get("name")), phone: s(f.get("phone")), licenseState: s(f.get("licenseState")), licenseExpiresAt: f.get("licenseExpiresAt") ? new Date(f.get("licenseExpiresAt") as string).toISOString() : null, email: s(f.get("email")) } }), "Driver added.", () => (e.target as HTMLFormElement).reset());
      }}
    >
      <input name="name" required className="field" placeholder="Full name" aria-label="Name" />
      <input name="phone" className="field" placeholder="Phone" aria-label="Phone" />
      <select name="licenseState" className="field" aria-label="CDL state" defaultValue="">
        <option value="">CDL state</option>
        {US_STATES.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <input name="licenseExpiresAt" type="date" className="field" aria-label="CDL expires" />
      <input name="email" type="email" className="field" placeholder="Email (links app login)" aria-label="Email" />
      <div className="md:col-span-5 flex items-center gap-3">
        <Submit pending={pending} variant="secondary">
          Add driver
        </Submit>
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function EquipmentForm() {
  const { pending, error, ok, run } = useSubmit();
  const [type, setType] = useState("DRY_VAN");
  const carrier = type.startsWith("CAR_") || type === "HOTSHOT";
  return (
    <form
      className="grid gap-2 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () =>
            api("/fleet/equipment", {
              body: { unitNumber: s(f.get("unitNumber")), type, vehicleCapacity: carrier ? Number(f.get("cap") || 0) || null : null, maxWeightLb: f.get("maxWeight") ? Number(f.get("maxWeight")) : null, plate: s(f.get("plate")), currentCity: s(f.get("city")), currentState: s(f.get("state")) },
            }),
          "Equipment added.",
          () => (e.target as HTMLFormElement).reset(),
        );
      }}
    >
      <input name="unitNumber" required className="field" placeholder="Unit #" aria-label="Unit number" />
      <select className="field" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
        {EQUIPMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {EQUIPMENT_LABEL[t]}
          </option>
        ))}
      </select>
      {carrier ? <input name="cap" type="number" min={1} max={12} required className="field" placeholder="Vehicle slots" aria-label="Vehicle capacity" /> : <input name="maxWeight" type="number" className="field" placeholder="Max lb" aria-label="Max weight" />}
      <input name="plate" className="field" placeholder="Plate" aria-label="Plate" />
      <input name="city" className="field" placeholder="Current city" aria-label="City" />
      <select name="state" className="field" defaultValue="" aria-label="State">
        <option value="">State</option>
        {US_STATES.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <div className="md:col-span-6 flex items-center gap-3">
        <Submit pending={pending} variant="secondary">
          Add equipment
        </Submit>
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function EquipmentStatus({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useSubmit();
  return (
    <span>
      <select className="rounded border border-slate-300 px-1 py-0.5 text-xs" defaultValue={status} disabled={pending} onChange={(e) => run(() => api(`/fleet/equipment/${id}`, { method: "PATCH", body: { status: e.target.value } }))} aria-label="Status">
        {["AVAILABLE", "IN_USE", "MAINTENANCE"].map((x) => (
          <option key={x} value={x}>
            {x.replace("_", " ").toLowerCase()}
          </option>
        ))}
      </select>
      {error && <span className="ml-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}

interface V { id: string; label: string; enclosed: boolean }

/** Plan a car-carrier trip: capacity and open/enclosed compatibility are enforced by the server. */
export function TripPlanner({ carriers, drivers, vehicles }: { carriers: { id: string; label: string; capacity: number; enclosed: boolean }[]; drivers: { id: string; name: string }[]; vehicles: V[] }) {
  const { pending, error, ok, run } = useSubmit();
  const [unit, setUnit] = useState(carriers[0]?.id ?? "");
  const [chosen, setChosen] = useState<string[]>([]);
  const cap = carriers.find((c) => c.id === unit);
  if (!carriers.length) return <p className="text-sm text-slate-500">Add a car carrier with vehicle slots to plan trips.</p>;
  const over = cap ? chosen.length > cap.capacity : false;
  const incompatible = cap && !cap.enclosed ? vehicles.filter((v) => chosen.includes(v.id) && v.enclosed) : [];
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api("/fleet/trips", { body: { name: s(f.get("name")), equipmentId: unit, driverId: s(f.get("driverId")), plannedStart: f.get("start") ? new Date(f.get("start") as string).toISOString() : null, vehicleIds: chosen } }), "Trip planned.", () => setChosen([]));
      }}
    >
      <div className="grid gap-2 md:grid-cols-4">
        <Field label="Trip name">
          <input name="name" required className="field" placeholder="ATL → BNA Tuesday" />
        </Field>
        <Field label="Carrier">
          <select className="field" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Driver">
          <select name="driverId" className="field">
            <option value="">Unassigned</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Planned start">
          <input name="start" type="datetime-local" className="field" />
        </Field>
      </div>
      <div>
        <p className="label">
          Vehicles to load ({chosen.length}/{cap?.capacity ?? 0} slots)
        </p>
        {vehicles.length === 0 ? (
          <p className="text-sm text-slate-500">No awarded vehicles are waiting for a trip.</p>
        ) : (
          <ul className="grid gap-1 md:grid-cols-2">
            {vehicles.map((v) => (
              <li key={v.id}>
                <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={chosen.includes(v.id)} onChange={(e) => setChosen((xs) => (e.target.checked ? [...xs, v.id] : xs.filter((x) => x !== v.id)))} />
                  {v.label}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {over && <p className="text-sm text-red-600">Too many vehicles for this carrier&apos;s slots.</p>}
      {incompatible.length > 0 && <p className="text-sm text-red-600">Enclosed-transport vehicles cannot go on an open carrier.</p>}
      <FormStatus error={error} ok={ok} />
      <button className={buttonClass("primary")} disabled={pending || over || incompatible.length > 0}>
        {pending ? "Working…" : "Create trip"}
      </button>
    </form>
  );
}
