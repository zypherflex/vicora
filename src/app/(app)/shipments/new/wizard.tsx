"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ACCESSORIALS,
  ACCESSORIAL_LABEL,
  EQUIPMENT_LABEL,
  EQUIPMENT_TYPES,
  ORG_TYPE_LABEL,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  US_STATES,
  type Accessorial,
  type EquipmentType,
  type OrgType,
  type ServiceType,
} from "@/lib/domain";
import { api } from "@/lib/client/api";
import { parseToMinor, formatMoney } from "@/lib/money";
import { stateTimeZone, zonedWallTimeToUtc } from "@/lib/time";
import { Badge, buttonClass, Card, cx, Notice } from "@/components/ui";
import { Field, FormStatus, useSubmit } from "@/components/ui/client";

type StopKind = "PICKUP" | "DELIVERY" | "PORT" | "RAIL_RAMP" | "TERMINAL" | "AUCTION" | "DEALERSHIP";
interface Stop { kind: StopKind; name: string; address1: string; city: string; state: string; postalCode: string; windowStart: string; windowEnd: string; timezone: string; contactName: string; contactPhone: string; reference: string; notes: string }
interface Item { description: string; quantity: string; packaging: string; lengthIn: string; widthIn: string; heightIn: string; weightLb: string; freightClass: string; stackable: boolean; hazmat: boolean }
interface Vehicle { vin: string; year: string; make: string; model: string; color: string; operable: boolean; transportType: "OPEN" | "ENCLOSED"; auctionReference: string; dealershipReference: string; notes: string }

const blankStop = (kind: StopKind): Stop => ({ kind, name: "", address1: "", city: "", state: "", postalCode: "", windowStart: "", windowEnd: "", timezone: "", contactName: "", contactPhone: "", reference: "", notes: "" });
const blankItem = (): Item => ({ description: "", quantity: "1", packaging: "PALLET", lengthIn: "48", widthIn: "40", heightIn: "", weightLb: "", freightClass: "", stackable: true, hazmat: false });
const blankVehicle = (): Vehicle => ({ vin: "", year: "", make: "", model: "", color: "", operable: true, transportType: "OPEN", auctionReference: "", dealershipReference: "", notes: "" });

const STEPS = ["Service", "Stops", "Cargo", "Customs", "Quotes & review"] as const;
const DEFAULT_EQUIPMENT: Partial<Record<ServiceType, EquipmentType>> = { FTL: "DRY_VAN", LTL: "BOX_TRUCK", AUTO_TRANSPORT: "CAR_CARRIER_OPEN", PORT_TO_DOOR: "CONTAINER_CHASSIS_40", INTERMODAL: "CONTAINER_CHASSIS_40" };
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const n = (v: string) => (v.trim() === "" ? null : Number(v));
const s = (v: string) => (v.trim() === "" ? null : v.trim());

export function BookingWizard({ providers }: { providers: { id: string; name: string; type: OrgType; state: string | null }[] }) {
  const router = useRouter();
  const { pending, error, run, setError } = useSubmit();
  const [step, setStep] = useState(0);
  const [serviceType, setServiceType] = useState<ServiceType>("FTL");
  const [title, setTitle] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [equipmentType, setEquipmentType] = useState<EquipmentType | "">("DRY_VAN");
  const [commodity, setCommodity] = useState("");
  const [accessorials, setAccessorials] = useState<Accessorial[]>([]);
  const [hazmat, setHazmat] = useState(false);
  const [tempMin, setTempMin] = useState("");
  const [tempMax, setTempMax] = useState("");
  const [special, setSpecial] = useState("");
  const [stops, setStops] = useState<Stop[]>([blankStop("PICKUP"), blankStop("DELIVERY")]);
  const [items, setItems] = useState<Item[]>([blankItem()]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([blankVehicle()]);
  const [requiresCustoms, setRequiresCustoms] = useState(false);
  const [intl, setIntl] = useState({ portOfEntry: "", vesselVoyage: "", containerNumber: "", billOfLadingNumber: "", countryOfOrigin: "", portEta: "" });
  const [budget, setBudget] = useState("");
  const [visibility, setVisibility] = useState<"MARKETPLACE" | "INVITED">("MARKETPLACE");
  const [invited, setInvited] = useState<string[]>([]);

  const isAuto = serviceType === "AUTO_TRANSPORT";
  const isIntl = serviceType === "PORT_TO_DOOR" || requiresCustoms;
  const steps = STEPS.filter((x) => x !== "Customs" || isIntl);
  const current = steps[step];

  const totalWeight = items.reduce((a, i) => a + (Number(i.weightLb) || 0), 0);
  const eligibleProviders = useMemo(() => providers.filter((p) => (isAuto ? p.type === "AUTO_TRANSPORT" || p.type === "FREIGHT_BROKER" : p.type !== "AUTO_TRANSPORT")), [providers, isAuto]);

  function setStop(i: number, patch: Partial<Stop>) {
    setStops((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function chooseService(t: ServiceType) {
    setServiceType(t);
    setEquipmentType(DEFAULT_EQUIPMENT[t] ?? "");
    if (t === "PORT_TO_DOOR") {
      setRequiresCustoms(true);
      setStops((xs) => [{ ...xs[0], kind: "PORT" }, ...xs.slice(1)]);
    } else if (t === "AUTO_TRANSPORT") {
      setStops((xs) => xs.map((x, i) => (i === 0 && x.kind === "PORT" ? { ...x, kind: "PICKUP" } : x)));
    }
  }

  /** Client-side checks mirror the server's validation so people get feedback per step. */
  function validate(name: (typeof STEPS)[number]): string | null {
    if (name === "Service") {
      if (!title.trim()) return "Give the shipment a short title.";
      if (equipmentType === "REEFER" && (tempMin === "" || tempMax === "")) return "Set a temperature range for reefer loads.";
      if (tempMin !== "" && tempMax !== "" && Number(tempMin) > Number(tempMax)) return "Max temperature must be at least the min.";
    }
    if (name === "Stops") {
      for (const [i, st] of stops.entries()) {
        if (!st.name.trim() || !st.city.trim() || !st.state) return `Stop ${i + 1}: name, city and state are required.`;
        if (st.postalCode && !/^\d{5}(-\d{4})?$/.test(st.postalCode)) return `Stop ${i + 1}: use a 5-digit ZIP.`;
        if (st.windowStart && st.windowEnd && st.windowEnd < st.windowStart) return `Stop ${i + 1}: window end is before start.`;
      }
      const last = stops[stops.length - 1];
      if (last.kind !== "DELIVERY" && last.kind !== "DEALERSHIP") return "The final stop must be a delivery or dealership.";
    }
    if (name === "Cargo") {
      if (isAuto) {
        const vins = new Set<string>();
        for (const [i, v] of vehicles.entries()) {
          const vin = v.vin.trim().toUpperCase();
          if (!VIN_RE.test(vin)) return `Vehicle ${i + 1}: VIN must be 17 characters with no I, O or Q.`;
          if (vins.has(vin)) return `Vehicle ${i + 1}: duplicate VIN.`;
          vins.add(vin);
          if (!v.year || !v.make.trim() || !v.model.trim()) return `Vehicle ${i + 1}: year, make and model are required.`;
        }
      } else {
        for (const [i, it] of items.entries()) {
          if (!it.description.trim()) return `Line ${i + 1}: describe the cargo.`;
          if (!(Number(it.quantity) >= 1)) return `Line ${i + 1}: quantity must be at least 1.`;
          if (!(Number(it.weightLb) >= 1)) return `Line ${i + 1}: enter the weight in pounds.`;
        }
      }
    }
    if (name === "Customs" && intl.containerNumber && !/^[A-Z]{4}\d{7}$/.test(intl.containerNumber.toUpperCase())) return "Container numbers are 4 letters followed by 7 digits.";
    if (name === "Quotes & review") {
      if (budget) {
        try {
          parseToMinor(budget);
        } catch {
          return "Enter the budget as a dollar amount, like 2400 or 2,400.00.";
        }
      }
      if (visibility === "INVITED" && invited.length === 0) return "Invite at least one provider, or open the request to the marketplace.";
    }
    return null;
  }

  function next() {
    const e = validate(current);
    if (e) return setError(e);
    setError(null);
    setStep((x) => Math.min(x + 1, steps.length - 1));
  }

  function payload(submit: boolean) {
    return {
      serviceType,
      title: title.trim(),
      customerReference: s(customerReference),
      requiresCustoms: isIntl,
      commodity: s(commodity),
      equipmentType: equipmentType || null,
      accessorials,
      hazmat,
      temperatureMinF: n(tempMin),
      temperatureMaxF: n(tempMax),
      specialInstructions: s(special),
      currency: "USD",
      targetBudgetMinor: budget ? parseToMinor(budget) : null,
      quoteVisibility: visibility,
      invitedProviderOrgIds: visibility === "INVITED" ? invited : [],
      stops: stops.map((st) => {
        const tz = st.timezone || stateTimeZone(st.state);
        return {
          kind: st.kind,
          name: st.name.trim(),
          address1: s(st.address1),
          city: st.city.trim(),
          state: st.state,
          postalCode: s(st.postalCode),
          windowStart: st.windowStart ? zonedWallTimeToUtc(st.windowStart, tz).toISOString() : null,
          windowEnd: st.windowEnd ? zonedWallTimeToUtc(st.windowEnd, tz).toISOString() : null,
          timezone: tz,
          contactName: s(st.contactName),
          contactPhone: s(st.contactPhone),
          reference: s(st.reference),
          notes: s(st.notes),
        };
      }),
      items: isAuto
        ? []
        : items.map((it) => ({
            description: it.description.trim(),
            quantity: Number(it.quantity),
            packaging: it.packaging,
            lengthIn: n(it.lengthIn),
            widthIn: n(it.widthIn),
            heightIn: n(it.heightIn),
            weightLb: Number(it.weightLb),
            freightClass: serviceType === "LTL" ? s(it.freightClass) : null,
            stackable: it.stackable,
            hazmat: it.hazmat,
          })),
      vehicles: isAuto
        ? vehicles.map((v) => ({
            vin: v.vin.trim().toUpperCase(),
            year: Number(v.year),
            make: v.make.trim(),
            model: v.model.trim(),
            color: s(v.color),
            operable: v.operable,
            transportType: v.transportType,
            auctionReference: s(v.auctionReference),
            dealershipReference: s(v.dealershipReference),
            notes: s(v.notes),
          }))
        : [],
      international: isIntl
        ? {
            portOfEntry: s(intl.portOfEntry),
            vesselVoyage: s(intl.vesselVoyage),
            containerNumber: s(intl.containerNumber)?.toUpperCase() ?? null,
            billOfLadingNumber: s(intl.billOfLadingNumber),
            countryOfOrigin: s(intl.countryOfOrigin)?.toUpperCase() ?? null,
            portEta: intl.portEta ? new Date(intl.portEta).toISOString() : null,
          }
        : undefined,
      submit,
    };
  }

  function save(submit: boolean) {
    for (const st of steps) {
      const e = validate(st);
      if (e) {
        setStep(steps.indexOf(st));
        return setError(e);
      }
    }
    run(
      () => api<{ id: string }>("/shipments", { body: payload(submit) }),
      undefined,
      (r) => router.push(`/shipments/${(r as { id: string }).id}${submit ? "?tab=quotes" : ""}`),
    );
  }

  const originKinds: StopKind[] = isAuto ? ["PICKUP", "AUCTION", "DEALERSHIP", "PORT"] : ["PICKUP", "PORT", "RAIL_RAMP", "TERMINAL"];

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col">
        {steps.map((x, i) => (
          <li key={x}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className={cx("flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm", i === step ? "bg-brand-50 font-semibold text-brand-700" : i < step ? "text-slate-700 hover:bg-slate-100" : "text-slate-400")}
            >
              <span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-xs", i <= step ? "bg-brand-600 text-white" : "bg-slate-200")}>{i + 1}</span>
              {x}
            </button>
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        {current === "Service" && (
          <Card title="What are you moving?">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {SERVICE_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => chooseService(t)} className={cx("rounded-lg border p-3 text-left text-sm", serviceType === t ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300")}>
                  <span className="font-medium">{SERVICE_TYPE_LABEL[t]}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Title">
                <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isAuto ? "3 sedans, Atlanta auction to Nashville store" : "Spring collection to Dallas DC"} />
              </Field>
              <Field label="Your reference (PO, order #)">
                <input className="field" value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} />
              </Field>
              <Field label="Equipment">
                <select className="field" value={equipmentType} onChange={(e) => setEquipmentType(e.target.value as EquipmentType)}>
                  <option value="">No preference</option>
                  {EQUIPMENT_TYPES.filter((e) => (isAuto ? e.startsWith("CAR_") || e === "HOTSHOT" : !e.startsWith("CAR_"))).map((e) => (
                    <option key={e} value={e}>
                      {EQUIPMENT_LABEL[e]}
                    </option>
                  ))}
                </select>
              </Field>
              {!isAuto && (
                <Field label="Commodity">
                  <input className="field" value={commodity} onChange={(e) => setCommodity(e.target.value)} placeholder="Boxed furniture, auto parts…" />
                </Field>
              )}
              {equipmentType === "REEFER" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Min temp (°F)">
                    <input className="field" type="number" value={tempMin} onChange={(e) => setTempMin(e.target.value)} />
                  </Field>
                  <Field label="Max temp (°F)">
                    <input className="field" type="number" value={tempMax} onChange={(e) => setTempMax(e.target.value)} />
                  </Field>
                </div>
              )}
              {!isAuto && serviceType !== "PORT_TO_DOOR" && (
                <label className="flex items-center gap-2 self-end text-sm">
                  <input type="checkbox" checked={requiresCustoms} onChange={(e) => setRequiresCustoms(e.target.checked)} /> This is an import that needs a customs broker
                </label>
              )}
            </div>
            <fieldset className="mt-4">
              <legend className="label">Accessorials</legend>
              <div className="flex flex-wrap gap-2">
                {ACCESSORIALS.filter((a) => (isAuto ? ["RESIDENTIAL", "APPOINTMENT", "TOP_LOAD", "INSIDE_DELIVERY"].includes(a) : a !== "TOP_LOAD")).map((a) => (
                  <label key={a} className={cx("cursor-pointer rounded-full border px-3 py-1 text-xs", accessorials.includes(a) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300")}>
                    <input type="checkbox" className="sr-only" checked={accessorials.includes(a)} onChange={(e) => setAccessorials((xs) => (e.target.checked ? [...xs, a] : xs.filter((x) => x !== a)))} />
                    {ACCESSORIAL_LABEL[a]}
                  </label>
                ))}
              </div>
            </fieldset>
            {!isAuto && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hazmat} onChange={(e) => setHazmat(e.target.checked)} /> Contains hazardous materials
              </label>
            )}
            <Field label="Special instructions" className="mt-3">
              <textarea className="field" rows={3} value={special} onChange={(e) => setSpecial(e.target.value)} />
            </Field>
          </Card>
        )}

        {current === "Stops" && (
          <Card title="Stops" actions={stops.length < 10 && <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setStops((xs) => [...xs.slice(0, -1), blankStop(isAuto ? "PICKUP" : "PICKUP"), xs[xs.length - 1]])}><Plus className="h-3.5 w-3.5" /> Add stop</button>}>
            <p className="mb-3 text-xs text-slate-500">Appointment windows are entered in each stop&apos;s local time and stored in UTC.</p>
            <div className="space-y-4">
              {stops.map((st, i) => {
                const last = i === stops.length - 1;
                const kinds: StopKind[] = i === 0 ? originKinds : last ? ["DELIVERY", "DEALERSHIP"] : ["PICKUP", "DELIVERY", "TERMINAL", "RAIL_RAMP"];
                const tz = st.timezone || stateTimeZone(st.state);
                return (
                  <div key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold">{i === 0 ? "Origin" : last ? "Final destination" : `Stop ${i + 1}`}</p>
                      {!last && i > 0 && (
                        <button type="button" className="text-slate-400 hover:text-red-600" aria-label="Remove stop" onClick={() => setStops((xs) => xs.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <Field label="Type">
                        <select className="field" value={st.kind} onChange={(e) => setStop(i, { kind: e.target.value as StopKind })}>
                          {kinds.map((k) => (
                            <option key={k} value={k}>
                              {k.replace("_", " ").toLowerCase()}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Location name" className="md:col-span-3">
                        <input className="field" value={st.name} onChange={(e) => setStop(i, { name: e.target.value })} placeholder={st.kind === "PORT" ? "Port of Long Beach, Pier T" : "Joliet DC"} />
                      </Field>
                      <Field label="Street address" className="md:col-span-2">
                        <input className="field" value={st.address1} onChange={(e) => setStop(i, { address1: e.target.value })} />
                      </Field>
                      <Field label="City">
                        <input className="field" value={st.city} onChange={(e) => setStop(i, { city: e.target.value })} />
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="State">
                          <select className="field" value={st.state} onChange={(e) => setStop(i, { state: e.target.value })}>
                            <option value="">—</option>
                            {US_STATES.map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="ZIP">
                          <input className="field" inputMode="numeric" value={st.postalCode} onChange={(e) => setStop(i, { postalCode: e.target.value })} />
                        </Field>
                      </div>
                      <Field label="Window opens" hint={st.state ? tz.replace("_", " ") : undefined}>
                        <input className="field" type="datetime-local" value={st.windowStart} onChange={(e) => setStop(i, { windowStart: e.target.value })} />
                      </Field>
                      <Field label="Window closes">
                        <input className="field" type="datetime-local" value={st.windowEnd} onChange={(e) => setStop(i, { windowEnd: e.target.value })} />
                      </Field>
                      <Field label="Contact name">
                        <input className="field" value={st.contactName} onChange={(e) => setStop(i, { contactName: e.target.value })} />
                      </Field>
                      <Field label="Contact phone">
                        <input className="field" type="tel" value={st.contactPhone} onChange={(e) => setStop(i, { contactPhone: e.target.value })} />
                      </Field>
                      <Field label="Stop reference" className="md:col-span-2">
                        <input className="field" value={st.reference} onChange={(e) => setStop(i, { reference: e.target.value })} placeholder={st.kind === "AUCTION" ? "Auction lot / gate pass" : "Appointment #, dock"} />
                      </Field>
                      <Field label="Notes" className="md:col-span-2">
                        <input className="field" value={st.notes} onChange={(e) => setStop(i, { notes: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {current === "Cargo" && !isAuto && (
          <Card title={`Cargo · ${totalWeight.toLocaleString()} lb total`} actions={<button type="button" className={buttonClass("secondary", "sm")} onClick={() => setItems((xs) => [...xs, blankItem()])}><Plus className="h-3.5 w-3.5" /> Add line</button>}>
            <div className="space-y-3">
              {items.map((it, i) => {
                const set = (p: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-8">
                    <Field label="Description" className="md:col-span-3">
                      <input className="field" value={it.description} onChange={(e) => set({ description: e.target.value })} />
                    </Field>
                    <Field label="Qty">
                      <input className="field" type="number" min={1} value={it.quantity} onChange={(e) => set({ quantity: e.target.value })} />
                    </Field>
                    <Field label="Packaging">
                      <select className="field" value={it.packaging} onChange={(e) => set({ packaging: e.target.value })}>
                        {["PALLET", "CRATE", "BOX", "DRUM", "ROLL", "CONTAINER", "PIECE"].map((p) => (
                          <option key={p} value={p}>
                            {p.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Weight (lb)">
                      <input className="field" type="number" min={1} value={it.weightLb} onChange={(e) => set({ weightLb: e.target.value })} />
                    </Field>
                    {serviceType === "LTL" ? (
                      <Field label="Freight class">
                        <select className="field" value={it.freightClass} onChange={(e) => set({ freightClass: e.target.value })}>
                          <option value="">—</option>
                          {["50", "55", "60", "65", "70", "77.5", "85", "92.5", "100", "110", "125", "150", "175", "200", "250", "300", "400", "500"].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </Field>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-end justify-end">
                      {items.length > 1 && (
                        <button type="button" className="p-2 text-slate-400 hover:text-red-600" aria-label="Remove line" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 md:col-span-3">
                      <Field label="L (in)">
                        <input className="field" type="number" value={it.lengthIn} onChange={(e) => set({ lengthIn: e.target.value })} />
                      </Field>
                      <Field label="W (in)">
                        <input className="field" type="number" value={it.widthIn} onChange={(e) => set({ widthIn: e.target.value })} />
                      </Field>
                      <Field label="H (in)">
                        <input className="field" type="number" value={it.heightIn} onChange={(e) => set({ heightIn: e.target.value })} />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 self-end text-sm md:col-span-2">
                      <input type="checkbox" checked={it.stackable} onChange={(e) => set({ stackable: e.target.checked })} /> Stackable
                    </label>
                    <label className="flex items-center gap-2 self-end text-sm md:col-span-2">
                      <input type="checkbox" checked={it.hazmat} onChange={(e) => set({ hazmat: e.target.checked })} /> Hazmat
                    </label>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {current === "Cargo" && isAuto && (
          <Card title={`Vehicles (${vehicles.length})`} actions={vehicles.length < 12 && <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setVehicles((xs) => [...xs, blankVehicle()])}><Plus className="h-3.5 w-3.5" /> Add vehicle</button>}>
            <div className="space-y-3">
              {vehicles.map((v, i) => {
                const set = (p: Partial<Vehicle>) => setVehicles((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
                const vinOk = VIN_RE.test(v.vin.trim().toUpperCase());
                return (
                  <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-6">
                    <Field label="VIN" className="md:col-span-2" hint={v.vin && !vinOk ? "17 characters, no I/O/Q" : undefined}>
                      <input className={cx("field font-mono uppercase", v.vin && !vinOk && "border-red-400")} maxLength={17} value={v.vin} onChange={(e) => set({ vin: e.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="Year">
                      <input className="field" type="number" value={v.year} onChange={(e) => set({ year: e.target.value })} />
                    </Field>
                    <Field label="Make">
                      <input className="field" value={v.make} onChange={(e) => set({ make: e.target.value })} />
                    </Field>
                    <Field label="Model">
                      <input className="field" value={v.model} onChange={(e) => set({ model: e.target.value })} />
                    </Field>
                    <Field label="Color">
                      <input className="field" value={v.color} onChange={(e) => set({ color: e.target.value })} />
                    </Field>
                    <Field label="Transport">
                      <select className="field" value={v.transportType} onChange={(e) => set({ transportType: e.target.value as "OPEN" | "ENCLOSED" })}>
                        <option value="OPEN">Open</option>
                        <option value="ENCLOSED">Enclosed</option>
                      </select>
                    </Field>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <input type="checkbox" checked={v.operable} onChange={(e) => set({ operable: e.target.checked })} /> Runs and drives
                    </label>
                    <Field label="Auction ref / lot">
                      <input className="field" value={v.auctionReference} onChange={(e) => set({ auctionReference: e.target.value })} />
                    </Field>
                    <Field label="Dealer stock #">
                      <input className="field" value={v.dealershipReference} onChange={(e) => set({ dealershipReference: e.target.value })} />
                    </Field>
                    <Field label="Notes" className="md:col-span-1">
                      <input className="field" value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
                    </Field>
                    <div className="flex items-end justify-end">
                      {vehicles.length > 1 && (
                        <button type="button" className="p-2 text-slate-400 hover:text-red-600" aria-label="Remove vehicle" onClick={() => setVehicles((xs) => xs.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {vehicles.some((v) => !v.operable) && <Notice tone="amber">Inoperable vehicles need a winch or forklift at pickup; providers will see this flag.</Notice>}
          </Card>
        )}

        {current === "Customs" && (
          <Card title="Import details">
            <Notice>
              You can appoint a customs broker on the shipment after booking. Vicora organizes documents and work for the broker; it does not determine classifications or duties.
            </Notice>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Field label="Port of entry">
                <input className="field" value={intl.portOfEntry} onChange={(e) => setIntl({ ...intl, portOfEntry: e.target.value })} placeholder="Long Beach, CA" />
              </Field>
              <Field label="Vessel / voyage">
                <input className="field" value={intl.vesselVoyage} onChange={(e) => setIntl({ ...intl, vesselVoyage: e.target.value })} />
              </Field>
              <Field label="Port ETA">
                <input className="field" type="date" value={intl.portEta} onChange={(e) => setIntl({ ...intl, portEta: e.target.value })} />
              </Field>
              <Field label="Container number">
                <input className="field font-mono uppercase" maxLength={11} value={intl.containerNumber} onChange={(e) => setIntl({ ...intl, containerNumber: e.target.value.toUpperCase() })} placeholder="MSCU1234567" />
              </Field>
              <Field label="Bill of lading #">
                <input className="field" value={intl.billOfLadingNumber} onChange={(e) => setIntl({ ...intl, billOfLadingNumber: e.target.value })} />
              </Field>
              <Field label="Country of origin (ISO-2)">
                <input className="field uppercase" maxLength={2} value={intl.countryOfOrigin} onChange={(e) => setIntl({ ...intl, countryOfOrigin: e.target.value.toUpperCase() })} placeholder="VN" />
              </Field>
            </div>
          </Card>
        )}

        {current === "Quotes & review" && (
          <>
            <Card title="Who can quote?">
              <div className="grid gap-3 md:grid-cols-2">
                <label className={cx("cursor-pointer rounded-lg border p-3 text-sm", visibility === "MARKETPLACE" ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
                  <input type="radio" className="sr-only" checked={visibility === "MARKETPLACE"} onChange={() => setVisibility("MARKETPLACE")} />
                  <span className="font-medium">Open marketplace</span>
                  <p className="text-xs text-slate-500">Any matching provider on Vicora sees a limited preview (no contacts) and can quote.</p>
                </label>
                <label className={cx("cursor-pointer rounded-lg border p-3 text-sm", visibility === "INVITED" ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
                  <input type="radio" className="sr-only" checked={visibility === "INVITED"} onChange={() => setVisibility("INVITED")} />
                  <span className="font-medium">Invited providers only</span>
                  <p className="text-xs text-slate-500">Only the providers you pick can see and quote.</p>
                </label>
              </div>
              {visibility === "INVITED" && (
                <ul className="mt-3 grid gap-1 md:grid-cols-2">
                  {eligibleProviders.map((p) => (
                    <li key={p.id}>
                      <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                        <input type="checkbox" checked={invited.includes(p.id)} onChange={(e) => setInvited((xs) => (e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)))} />
                        {p.name} <span className="text-xs text-slate-500">{ORG_TYPE_LABEL[p.type]}{p.state ? ` · ${p.state}` : ""}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <Field label="Target budget (optional, USD)" className="mt-4 max-w-xs" hint="Shared with providers as guidance.">
                <input className="field" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="2,400.00" />
              </Field>
            </Card>
            <Card title="Review">
              <dl className="grid gap-2 text-sm md:grid-cols-2">
                <div><dt className="text-slate-500">Service</dt><dd className="font-medium">{SERVICE_TYPE_LABEL[serviceType]} {equipmentType && `· ${EQUIPMENT_LABEL[equipmentType]}`}</dd></div>
                <div><dt className="text-slate-500">Title</dt><dd className="font-medium">{title || "—"}</dd></div>
                <div className="md:col-span-2"><dt className="text-slate-500">Route</dt><dd className="font-medium">{stops.map((x) => (x.city ? `${x.city}, ${x.state}` : "?")).join(" → ")}</dd></div>
                <div><dt className="text-slate-500">{isAuto ? "Vehicles" : "Cargo"}</dt><dd className="font-medium">{isAuto ? `${vehicles.length} vehicle(s)` : `${items.length} line(s), ${totalWeight.toLocaleString()} lb`}</dd></div>
                <div><dt className="text-slate-500">Budget</dt><dd className="font-medium">{budget ? (() => { try { return formatMoney(parseToMinor(budget), "USD"); } catch { return "invalid"; } })() : "Not shared"}</dd></div>
                {isIntl && <div><dt className="text-slate-500">Customs</dt><dd><Badge tone="blue">Customs broker needed</Badge></dd></div>}
                {accessorials.length > 0 && <div className="md:col-span-2"><dt className="text-slate-500">Accessorials</dt><dd>{accessorials.map((a) => ACCESSORIAL_LABEL[a]).join(", ")}</dd></div>}
              </dl>
            </Card>
          </>
        )}

        <FormStatus error={error} />
        <div className="flex flex-wrap gap-2">
          {step > 0 && (
            <button type="button" className={buttonClass("secondary")} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < steps.length - 1 ? (
            <button type="button" className={buttonClass("primary")} onClick={next}>
              Continue
            </button>
          ) : (
            <>
              <button type="button" disabled={pending} className={buttonClass("primary")} onClick={() => save(true)}>
                {pending ? "Submitting…" : "Request quotes"}
              </button>
              <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => save(false)}>
                Save as draft
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
