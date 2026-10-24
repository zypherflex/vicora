"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHARGE_CODES, DOCUMENT_CATEGORIES, EXCEPTION_TYPES, LEG_STATUS_LABEL, type LegStatus } from "@/lib/domain";
import { api } from "@/lib/client/api";
import { formatMoney, lineAmount, parseToMinor } from "@/lib/money";
import { Badge, buttonClass, Notice } from "@/components/ui";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

const money = (v: string) => parseToMinor(v || "0");

/* ------------------------------------------------------------------ Status */

export function StatusControl({ shipmentId, options }: { shipmentId: string; options: { to: string; label: string; danger?: boolean }[] }) {
  const { pending, error, run } = useSubmit();
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button
          key={o.to}
          disabled={pending}
          className={buttonClass(o.danger ? "danger" : "secondary", "sm")}
          onClick={() => {
            const reason = o.danger ? window.prompt("Reason for cancelling (shared with parties)") : null;
            if (o.danger && !reason) return;
            run(() => api(`/shipments/${shipmentId}/status`, { body: { to: o.to, reason } }));
          }}
        >
          {o.label}
        </button>
      ))}
      <FormStatus error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Quotes */

interface Line { code: string; description: string; qty: string; unit: string }

export function QuoteForm({ shipmentId, defaultCode = "LINEHAUL" }: { shipmentId: string; defaultCode?: string }) {
  const { pending, error, ok, run } = useSubmit();
  const [lines, setLines] = useState<Line[]>([{ code: defaultCode, description: "Linehaul", qty: "1", unit: "" }]);
  const [cost, setCost] = useState("");
  const [transit, setTransit] = useState("");
  const [validDays, setValidDays] = useState("3");
  const [notes, setNotes] = useState("");
  let total = 0;
  let parseError = false;
  for (const l of lines) {
    try {
      total += lineAmount(Math.round(Number(l.qty || 0) * 1000), money(l.unit));
    } catch {
      parseError = true;
    }
  }
  let costMinor: number | null = null;
  try {
    costMinor = cost ? money(cost) : null;
  } catch {
    parseError = true;
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (parseError) return;
        run(
          () =>
            api(`/shipments/${shipmentId}/quotes`, {
              body: {
                currency: "USD",
                lines: lines.map((l) => ({ code: l.code, description: l.description || l.code, quantityMilli: Math.round(Number(l.qty) * 1000), unitAmountMinor: money(l.unit) })),
                estimatedCostMinor: costMinor,
                transitDays: transit ? Number(transit) : null,
                validUntil: new Date(Date.now() + Number(validDays || 3) * 86400_000).toISOString(),
                notes: notes || null,
              },
            }),
          "Quote submitted.",
        );
      }}
    >
      {lines.map((l, i) => {
        const set = (p: Partial<Line>) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return (
          <div key={i} className="grid grid-cols-12 gap-2">
            <select className="field col-span-3" value={l.code} onChange={(e) => set({ code: e.target.value })} aria-label="Charge code">
              {CHARGE_CODES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input className="field col-span-4" value={l.description} onChange={(e) => set({ description: e.target.value })} placeholder="Description" aria-label="Description" />
            <input className="field col-span-2" value={l.qty} onChange={(e) => set({ qty: e.target.value })} inputMode="decimal" aria-label="Quantity" />
            <input className="field col-span-3" value={l.unit} onChange={(e) => set({ unit: e.target.value })} inputMode="decimal" placeholder="Unit $" aria-label="Unit amount" />
          </div>
        );
      })}
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setLines((xs) => [...xs, { code: "ACCESSORIAL", description: "", qty: "1", unit: "" }])}>
        + Add line
      </button>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Transit days">
          <input className="field" type="number" min={0} value={transit} onChange={(e) => setTransit(e.target.value)} />
        </Field>
        <Field label="Valid for (days)">
          <input className="field" type="number" min={1} value={validDays} onChange={(e) => setValidDays(e.target.value)} />
        </Field>
        <Field label="Your cost (private)" hint="Never shown to the customer.">
          <input className="field" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes to customer">
        <textarea className="field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span>
          Total <strong>{parseError ? "—" : formatMoney(total, "USD")}</strong>
        </span>
        {costMinor != null && !parseError && (
          <span className="text-slate-500">
            Margin {formatMoney(total - costMinor, "USD")} {total > 0 && `(${(((total - costMinor) / total) * 100).toFixed(1)}%)`}
          </span>
        )}
      </div>
      {parseError && <p className="text-sm text-red-600">Amounts must be numbers like 1250 or 1,250.00.</p>}
      <FormStatus error={error} ok={ok} />
      <Submit pending={pending}>Submit quote</Submit>
    </form>
  );
}

/* ------------------------------------------------------------------ Tender & dispatch */

export function TenderForm({ shipmentId, legs, carriers, customerTotalMinor }: { shipmentId: string; legs: { id: string; label: string }[]; carriers: { orgId: string; name: string; eligible: boolean; score: number }[]; customerTotalMinor: number | null }) {
  const { pending, error, ok, run } = useSubmit();
  const [rate, setRate] = useState("");
  let rateMinor: number | null = null;
  try {
    rateMinor = rate ? money(rate) : null;
  } catch {
    rateMinor = null;
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (rateMinor == null) return;
        run(
          () =>
            api(`/shipments/${shipmentId}/tenders`, {
              body: { legId: f.get("legId"), carrierOrgId: f.get("carrierOrgId"), rateMinor, currency: "USD", notes: (f.get("notes") as string) || null, expiresInHours: Number(f.get("expires") || 24) },
            }),
          "Tender sent. The carrier sees the load and your offered rate only.",
        );
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Leg">
          <select name="legId" className="field">
            {legs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Carrier">
          <select name="carrierOrgId" className="field">
            {carriers.map((c) => (
              <option key={c.orgId} value={c.orgId} disabled={!c.eligible}>
                {c.name} · score {c.score}
                {c.eligible ? "" : " (ineligible)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Offered rate (USD)">
          <input className="field" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
        </Field>
        <Field label="Expires in (hours)">
          <input name="expires" className="field" type="number" min={1} max={168} defaultValue={24} />
        </Field>
      </div>
      {customerTotalMinor != null && rateMinor != null && (
        <p className="text-sm text-slate-600">
          Projected margin: <strong>{formatMoney(customerTotalMinor - rateMinor, "USD")}</strong> on {formatMoney(customerTotalMinor, "USD")} revenue
        </p>
      )}
      <Field label="Notes to carrier">
        <textarea name="notes" className="field" rows={2} />
      </Field>
      <FormStatus error={error} ok={ok} />
      <Submit pending={pending}>Send tender</Submit>
    </form>
  );
}

export function TenderResponse({ tenderId }: { tenderId: string }) {
  const { pending, error, run } = useSubmit();
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-2">
      <input className="field" placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <button disabled={pending} className={buttonClass("primary", "sm")} onClick={() => run(() => api(`/tenders/${tenderId}/respond`, { body: { accept: true, notes: notes || null } }))}>
          Accept tender
        </button>
        <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => api(`/tenders/${tenderId}/respond`, { body: { accept: false, notes: notes || null } }))}>
          Decline
        </button>
      </div>
      <FormStatus error={error} />
    </div>
  );
}

export function DispatchForm({ shipmentId, legId, drivers, equipment }: { shipmentId: string; legId: string; drivers: { id: string; name: string }[]; equipment: { id: string; label: string; disabled?: boolean }[] }) {
  const { pending, error, ok, run } = useSubmit();
  if (!drivers.length || !equipment.length) return <Notice tone="amber">Add drivers and equipment under Fleet before dispatching.</Notice>;
  return (
    <form
      className="grid gap-3 md:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api(`/shipments/${shipmentId}/dispatch`, { body: { legId, driverId: f.get("driverId"), equipmentId: f.get("equipmentId") } }), "Dispatched. The driver now sees this load in the driver app.");
      }}
    >
      <Field label="Driver">
        <select name="driverId" className="field">
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Equipment">
        <select name="equipmentId" className="field">
          {equipment.map((e) => (
            <option key={e.id} value={e.id} disabled={e.disabled}>
              {e.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end">
        <Submit pending={pending}>Dispatch</Submit>
      </div>
      <div className="md:col-span-3">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export const NEXT_LEG_STEP: Partial<Record<LegStatus, LegStatus[]>> = {
  DISPATCHED: ["AT_PICKUP", "PICKED_UP"],
  AT_PICKUP: ["PICKED_UP"],
  PICKED_UP: ["IN_TRANSIT", "AT_DELIVERY"],
  IN_TRANSIT: ["AT_DELIVERY", "DELIVERED"],
  AT_DELIVERY: ["DELIVERED"],
};

/** Milestone entry for dispatchers and drivers. Delivery requires a proof-of-delivery upload. */
export function MilestoneForm({ shipmentId, legId, status, compact }: { shipmentId: string; legId: string; status: LegStatus; compact?: boolean }) {
  const { pending, error, ok, run } = useSubmit();
  const nexts = NEXT_LEG_STEP[status] ?? [];
  const [to, setTo] = useState<LegStatus | "">(nexts[0] ?? "");
  const [podFile, setPodFile] = useState<File | null>(null);
  const [signer, setSigner] = useState("");
  const [note, setNote] = useState("");
  const [useGps, setUseGps] = useState(true);
  if (!nexts.length) return null;

  async function position(): Promise<{ lat: number; lng: number; source: "LIVE_GPS" } | null> {
    if (!useGps || !("geolocation" in navigator)) return null;
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, source: "LIVE_GPS" }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 },
      ),
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!to) return;
        run(async () => {
          let podDocumentId: string | null = null;
          if (to === "DELIVERED") {
            if (!podFile) throw new Error("Attach a photo or PDF of the signed proof of delivery.");
            if (!signer.trim()) throw new Error("Enter the name of the person who signed.");
            const form = new FormData();
            form.set("file", podFile);
            form.set("category", "POD");
            form.set("title", "Proof of delivery");
            const up = await api<{ documentId: string }>(`/shipments/${shipmentId}/documents`, { form });
            podDocumentId = up.documentId;
          }
          const pos = await position();
          return api(`/shipments/${shipmentId}/legs/${legId}/milestones`, {
            body: { status: to, note: note || null, podSignerName: signer || null, podDocumentId, lat: pos?.lat ?? null, lng: pos?.lng ?? null, locationSource: pos ? "LIVE_GPS" : undefined },
          });
        }, "Milestone recorded.");
      }}
    >
      <div className={compact ? "space-y-2" : "grid gap-2 md:grid-cols-3"}>
        <Field label="Next milestone">
          <select className="field" value={to} onChange={(e) => setTo(e.target.value as LegStatus)}>
            {nexts.map((n) => (
              <option key={n} value={n}>
                {LEG_STATUS_LABEL[n]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note" className={compact ? "" : "md:col-span-2"}>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Seal #, pallet count, dock…" />
        </Field>
      </div>
      {to === "DELIVERED" && (
        <div className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-2">
          <Field label="Signed POD (photo or PDF)">
            <input type="file" accept="image/*,application/pdf" capture="environment" className="block w-full text-sm" onChange={(e) => setPodFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Signed by">
            <input className="field" value={signer} onChange={(e) => setSigner(e.target.value)} />
          </Field>
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={useGps} onChange={(e) => setUseGps(e.target.checked)} /> Attach my device location (asks for permission)
      </label>
      <FormStatus error={error} ok={ok} />
      <Submit pending={pending}>Record {to ? LEG_STATUS_LABEL[to as LegStatus].toLowerCase() : "milestone"}</Submit>
    </form>
  );
}

/** Report a position: device GPS when permitted, otherwise a manually entered location. */
export function LocationReporter({ shipmentId, legId }: { shipmentId: string; legId: string }) {
  const { pending, error, ok, run } = useSubmit();
  const [manual, setManual] = useState({ lat: "", lng: "", label: "" });
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        className={buttonClass("secondary", "sm")}
        onClick={() =>
          run(
            () =>
              new Promise((resolve, reject) => {
                if (!("geolocation" in navigator)) return reject(new Error("This device does not expose location. Enter it manually."));
                navigator.geolocation.getCurrentPosition(
                  (p) => api(`/shipments/${shipmentId}/location`, { body: { legId, lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), source: "LIVE_GPS" } }).then(resolve, reject),
                  (err) => reject(new Error(err.code === 1 ? "Location permission was denied. Enter the location manually instead." : "Could not get a GPS fix. Enter the location manually.")),
                  { enableHighAccuracy: true, timeout: 10000 },
                );
              }),
            "Location shared.",
          )
        }
      >
        Share my GPS location
      </button>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-slate-500">Enter location manually</summary>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <input className="field" placeholder="Lat" inputMode="decimal" value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} />
          <input className="field" placeholder="Lng" inputMode="decimal" value={manual.lng} onChange={(e) => setManual({ ...manual, lng: e.target.value })} />
          <input className="field" placeholder="Near (e.g. I-65 MM 92)" value={manual.label} onChange={(e) => setManual({ ...manual, label: e.target.value })} />
        </div>
        <button
          type="button"
          disabled={pending}
          className={`${buttonClass("secondary", "sm")} mt-2`}
          onClick={() => run(() => api(`/shipments/${shipmentId}/location`, { body: { legId, lat: Number(manual.lat), lng: Number(manual.lng), source: "MANUAL", label: manual.label || null } }), "Location saved (manual).")}
        >
          Save manual location
        </button>
      </details>
      <FormStatus error={error} ok={ok} />
    </div>
  );
}

/* ------------------------------------------------------------------ Documents */

export function UploadForm({ shipmentId, canInternal, documentId }: { shipmentId: string; canInternal: boolean; documentId?: string }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (!(form.get("file") instanceof File) || !(form.get("file") as File).size) return;
        if (documentId) form.set("documentId", documentId);
        run(() => api(`/shipments/${shipmentId}/documents`, { form }), "Uploaded.", () => (e.target as HTMLFormElement).reset());
      }}
    >
      <Field label="File" className="md:col-span-2">
        <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.csv" className="block w-full text-sm" />
      </Field>
      <Field label="Category">
        <select name="category" className="field">
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Visibility">
        <select name="visibility" className="field" defaultValue="SHARED">
          <option value="SHARED">Shared with parties</option>
          {canInternal && <option value="INTERNAL">Internal to my org</option>}
        </select>
      </Field>
      <div className="flex items-end">
        <Submit pending={pending}>Upload</Submit>
      </div>
      <div className="md:col-span-5">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function DownloadButton({ versionId, label = "Open" }: { versionId: string; label?: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <button
        className="text-sm text-brand-600 hover:underline"
        onClick={async () => {
          setErr(null);
          try {
            const r = await api<{ url: string }>(`/document-versions/${versionId}/link`);
            window.open(r.url, "_blank", "noopener");
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {label}
      </button>
      {err && <span className="ml-2 text-xs text-red-600">{err}</span>}
    </span>
  );
}

export function DocRequestForm({ shipmentId }: { shipmentId: string }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api(`/shipments/${shipmentId}/document-requests`, { body: { category: f.get("category"), dueAt: f.get("dueAt") ? new Date(f.get("dueAt") as string).toISOString() : null, note: f.get("note") || null } }), "Requested.");
      }}
    >
      <select name="category" className="field" aria-label="Document type">
        {DOCUMENT_CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <input name="dueAt" type="date" className="field" aria-label="Due date" />
      <input name="note" className="field" placeholder="Note" aria-label="Note" />
      <Submit pending={pending} variant="secondary">
        Request document
      </Submit>
      <div className="md:col-span-4">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ Messages */

export function MessageForm({ shipmentId, canInternal, draft }: { shipmentId: string; canInternal: boolean; draft?: string }) {
  const { pending, error, run } = useSubmit();
  const [body, setBody] = useState(draft ?? "");
  const [internal, setInternal] = useState(false);
  const [aiDrafted] = useState(!!draft);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        run(() => api(`/shipments/${shipmentId}/messages`, { body: { body, visibility: internal ? "INTERNAL" : "SHARED", aiDrafted } }), undefined, () => setBody(""));
      }}
    >
      <textarea className="field" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? "Internal note: only your organization sees this" : "Message all parties on this shipment"} />
      <div className="flex flex-wrap items-center gap-3">
        {canInternal && (
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
          </label>
        )}
        {aiDrafted && <Badge tone="violet">AI-drafted, edit before sending</Badge>}
        <div className="ml-auto">
          <Submit pending={pending}>{internal ? "Save note" : "Send"}</Submit>
        </div>
      </div>
      <FormStatus error={error} />
    </form>
  );
}

/* ------------------------------------------------------------------ Exceptions */

export function ExceptionForm({ shipmentId, isCustomer }: { shipmentId: string; isCustomer: boolean }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () =>
            api(`/shipments/${shipmentId}/exceptions`, {
              body: { type: f.get("type"), severity: f.get("severity"), title: f.get("title"), description: f.get("description") || null, customerVisible: isCustomer || f.get("customerVisible") === "on" },
            }),
          "Exception opened.",
          () => (e.target as HTMLFormElement).reset(),
        );
      }}
    >
      <select name="type" className="field" aria-label="Type">
        {EXCEPTION_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replaceAll("_", " ").toLowerCase()}
          </option>
        ))}
      </select>
      <select name="severity" className="field" defaultValue="MEDIUM" aria-label="Severity">
        {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <input name="title" required className="field md:col-span-2" placeholder="What happened?" aria-label="Title" />
      <textarea name="description" className="field md:col-span-3" rows={2} placeholder="Details" aria-label="Details" />
      <div className="flex flex-col justify-end gap-2">
        {!isCustomer && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" name="customerVisible" /> Visible to customer
          </label>
        )}
        <Submit pending={pending} variant="secondary">
          Open exception
        </Submit>
      </div>
      <div className="md:col-span-4">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function ExceptionActions({ exceptionId, status }: { exceptionId: string; status: string }) {
  const { pending, error, run } = useSubmit();
  const [resolution, setResolution] = useState("");
  if (status === "RESOLVED") return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {status === "OPEN" && (
        <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => api(`/exceptions/${exceptionId}`, { method: "PATCH", body: { status: "ACKNOWLEDGED" } }))}>
          Acknowledge
        </button>
      )}
      <input className="field max-w-xs py-1" placeholder="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} />
      <button disabled={pending || !resolution.trim()} className={buttonClass("primary", "sm")} onClick={() => run(() => api(`/exceptions/${exceptionId}`, { method: "PATCH", body: { status: "RESOLVED", resolution } }))}>
        Resolve
      </button>
      <FormStatus error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Finance */

export function ChargeForm({ shipmentId }: { shipmentId: string }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () => api(`/shipments/${shipmentId}/charges`, { body: { code: f.get("code"), description: f.get("description"), quantityMilli: Math.round(Number(f.get("qty") || 1) * 1000), unitAmountMinor: money(f.get("unit") as string) } }),
          "Charge added. Accessorials from carriers need the bill-to party's approval.",
          () => (e.target as HTMLFormElement).reset(),
        );
      }}
    >
      <select name="code" className="field" aria-label="Charge code" defaultValue="DETENTION">
        {CHARGE_CODES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <input name="description" required className="field md:col-span-2" placeholder="Description" aria-label="Description" />
      <div className="grid grid-cols-2 gap-2">
        <input name="qty" className="field" defaultValue="1" inputMode="decimal" aria-label="Quantity" />
        <input name="unit" required className="field" placeholder="Unit $" inputMode="decimal" aria-label="Unit amount" />
      </div>
      <Submit pending={pending} variant="secondary">
        Add charge
      </Submit>
      <div className="md:col-span-5">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function InvoiceCreate({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className={buttonClass("primary", "sm")} onClick={() => run(() => api<{ invoice: { id: string } }>("/invoices", { body: { shipmentId, dueInDays: 30 } }), undefined, (r) => router.push(`/finance/invoices/${(r as { invoice: { id: string } }).invoice.id}`))}>
        Create invoice from confirmed charges
      </button>
      <FormStatus error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Tracking links */

export function TrackingLinkForm({ shipmentId }: { shipmentId: string }) {
  const { pending, error, run } = useSubmit();
  const [created, setCreated] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(() => api<{ path: string }>(`/shipments/${shipmentId}/tracking-links`, { body: { label: f.get("label") || null, expiresInDays: Number(f.get("days") || 14) } }), undefined, (r) => setCreated(`${window.location.origin}${(r as { path: string }).path}`));
        }}
      >
        <Field label="Recipient label">
          <input name="label" className="field" placeholder="Receiving dock, end customer…" />
        </Field>
        <Field label="Expires after (days)">
          <input name="days" type="number" min={1} max={90} defaultValue={14} className="field w-28" />
        </Field>
        <Submit pending={pending}>Create link</Submit>
      </form>
      {created && (
        <Notice tone="green">
          Copy this link now; it is shown only once. <code className="break-all">{created}</code>{" "}
          <button className="ml-2 underline" onClick={() => navigator.clipboard.writeText(created)}>
            Copy
          </button>
        </Notice>
      )}
      <FormStatus error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Customs */

export function AppointBroker({ shipmentId, brokers }: { shipmentId: string; brokers: { id: string; name: string }[] }) {
  const { pending, error, run } = useSubmit();
  const [id, setId] = useState(brokers[0]?.id ?? "");
  if (!brokers.length) return <p className="text-sm text-slate-500">No customs brokers are registered on Vicora yet.</p>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Customs broker">
        <select className="field" value={id} onChange={(e) => setId(e.target.value)}>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <button disabled={pending} className={buttonClass("primary")} onClick={() => run(() => api(`/shipments/${shipmentId}/customs-broker`, { body: { brokerOrgId: id } }))}>
        Appoint broker
      </button>
      <FormStatus error={error} />
    </div>
  );
}

export function OpenEntry({ shipmentId, portOfEntry, importerName }: { shipmentId: string; portOfEntry: string | null; importerName: string }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className={buttonClass("primary")} onClick={() => run(() => api<{ id: string }>(`/shipments/${shipmentId}/customs`, { body: { portOfEntry, importerName } }), undefined, (r) => router.push(`/customs/${(r as { id: string }).id}`))}>
        Open customs file
      </button>
      <FormStatus error={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ Copilot */

interface CopilotResult {
  text: string;
  engine: string;
  disclaimer: string;
  sources: { id: string; kind: string; label: string }[];
}

export function CopilotPanel({ shipmentId, canMessage }: { shipmentId: string; canMessage: boolean }) {
  const { pending, error, run } = useSubmit();
  const [res, setRes] = useState<(CopilotResult & { task: string; audience: string }) | null>(null);
  const ask = (task: string, audience: string) => run(() => api<CopilotResult>(`/shipments/${shipmentId}/copilot`, { body: { task, audience } }), undefined, (r) => setRes({ ...(r as CopilotResult), task, audience }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => ask("summarize", "internal")}>
          <Sparkles className="h-3.5 w-3.5" /> Summarize
        </button>
        <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => ask("next_steps", "internal")}>
          <Sparkles className="h-3.5 w-3.5" /> Suggest next steps
        </button>
        <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => ask("draft_update", "customer")}>
          <Sparkles className="h-3.5 w-3.5" /> Draft customer update
        </button>
      </div>
      {pending && <p className="text-sm text-slate-500">Reading the shipment record…</p>}
      <FormStatus error={error} />
      {res && (
        <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">{res.engine === "demo-rules" ? "Demo engine" : "AI"}</Badge>
            <span className="text-xs text-slate-500">{res.disclaimer}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{res.text}</p>
          {res.sources.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500">Based on</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">
                {res.sources.map((s) => (
                  <li key={s.id}>
                    {s.kind}: {s.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {res.task === "draft_update" && canMessage && (
            <div className="border-t border-violet-200 pt-3">
              <p className="mb-2 text-xs text-slate-600">Nothing is sent automatically. Edit the draft, then send it yourself.</p>
              <MessageForm key={res.text} shipmentId={shipmentId} canInternal={false} draft={res.text} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
