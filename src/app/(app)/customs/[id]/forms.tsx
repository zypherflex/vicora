"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { formatMoney, parseToMinor } from "@/lib/money";
import { Badge, buttonClass, Notice } from "@/components/ui";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

export function TaskDone({ id }: { id: string }) {
  const { pending, run } = useSubmit();
  return (
    <button disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => api(`/tasks/${id}/complete`, { body: {} }))}>
      Done
    </button>
  );
}

interface Field_ { key: string; label: string; value: string; confidence: number; source: { page: number | null; snippet: string } }

/**
 * Human review of AI-extracted fields. Each value shows its confidence and the exact source text.
 * Nothing becomes authoritative until a person approves it.
 */
export function ExtractionReview({ extractionId, fields, warnings, canApprove }: { extractionId: string; fields: Field_[]; warnings: string[]; canApprove: boolean }) {
  const { pending, error, ok, run } = useSubmit();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [apply, setApply] = useState(canApprove);
  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <Notice tone="amber">
          <ul className="list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      <ul className="space-y-2">
        {fields.map((f) => (
          <li key={f.key} className="grid gap-1 rounded-md border border-slate-200 p-2 md:grid-cols-[180px_1fr]">
            <div>
              <p className="text-sm font-medium">{f.label}</p>
              <Badge tone={f.confidence >= 0.85 ? "green" : f.confidence >= 0.6 ? "amber" : "red"}>{Math.round(f.confidence * 100)}% confidence</Badge>
            </div>
            <div>
              <input className="field" value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} aria-label={f.label} />
              <p className="mt-1 text-xs text-slate-500">
                Source{f.source.page ? ` p.${f.source.page}` : ""}: <q className="font-mono">{f.source.snippet || "not located in text"}</q>
              </p>
            </div>
          </li>
        ))}
      </ul>
      {canApprove && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> Apply approved value, origin and weight to the customs file
        </label>
      )}
      <FormStatus error={error} ok={ok} />
      <div className="flex gap-2">
        <button disabled={pending} className={buttonClass("primary", "sm")} onClick={() => run(() => api(`/extractions/${extractionId}/review`, { body: { decision: "APPROVED", fields: values, applyToEntry: apply } }), "Approved.")}>
          Approve reviewed values
        </button>
        <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => api(`/extractions/${extractionId}/review`, { body: { decision: "REJECTED", fields: {} } }), "Rejected.")}>
          Reject extraction
        </button>
      </div>
    </div>
  );
}

export function LineForm({ entryId, canApprove, line }: { entryId: string; canApprove: boolean; line?: { id: string; description: string; htsCode: string | null; quantity: number | null; valueMinor: number | null; countryOfOrigin: string | null; brokerReviewed: boolean } }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-7"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => ((f.get(k) as string) ?? "").trim();
        run(
          () =>
            api(line ? `/customs/${entryId}/lines/${line.id}` : `/customs/${entryId}/lines`, {
              method: line ? "PATCH" : "POST",
              body: { description: v("description"), htsCode: v("hts") || null, quantity: v("qty") ? Number(v("qty")) : null, valueMinor: v("value") ? parseToMinor(v("value")) : null, countryOfOrigin: v("coo") || null, brokerReviewed: f.get("reviewed") === "on" },
            }),
          line ? "Saved." : "Line added.",
          () => !line && (e.target as HTMLFormElement).reset(),
        );
      }}
    >
      <input name="description" required defaultValue={line?.description} className="field md:col-span-2" placeholder="Description" aria-label="Description" />
      <input name="hts" defaultValue={line?.htsCode ?? ""} className="field font-mono" placeholder="HTS 0000.00.00.00" aria-label="HTS code" />
      <input name="qty" defaultValue={line?.quantity ?? ""} className="field" inputMode="numeric" placeholder="Qty" aria-label="Quantity" />
      <input name="value" defaultValue={line?.valueMinor != null ? (line.valueMinor / 100).toFixed(2) : ""} className="field" inputMode="decimal" placeholder="Value USD" aria-label="Value" />
      <input name="coo" defaultValue={line?.countryOfOrigin ?? ""} maxLength={2} className="field uppercase" placeholder="COO" aria-label="Country of origin" />
      <div className="flex items-center gap-2">
        {canApprove && (
          <label className="flex items-center gap-1 text-xs" title="Licensed broker has reviewed classification and value">
            <input type="checkbox" name="reviewed" defaultChecked={line?.brokerReviewed} /> Reviewed
          </label>
        )}
        <Submit pending={pending} variant="secondary">
          {line ? "Save" : "Add"}
        </Submit>
      </div>
      <div className="md:col-span-7">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function CustomsStatusControl({ entryId, options }: { entryId: string; options: string[] }) {
  const { pending, error, run } = useSubmit();
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button key={o} disabled={pending} className={buttonClass(o === "HOLD" ? "danger" : "secondary", "sm")} onClick={() => run(() => api(`/customs/${entryId}/status`, { body: { status: o } }))}>
          {o === "HOLD" ? "Place on hold" : `Move to ${o.replaceAll("_", " ").toLowerCase()}`}
        </button>
      ))}
      <FormStatus error={error} />
    </div>
  );
}

export function FilingPanel({ entryId, adapters, ready, declaredValueMinor }: { entryId: string; adapters: { key: string; name: string; connected: boolean; demonstration: boolean; description: string }[]; ready: boolean; declaredValueMinor: number | null }) {
  const { pending, error, ok, run } = useSubmit();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3">
      {adapters.map((a) => (
        <div key={a.key} className="rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{a.name}</p>
            {a.connected ? a.demonstration ? <Badge tone="violet">Demonstration only</Badge> : <Badge tone="green">Connected</Badge> : <Badge tone="amber">Not connected</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">{a.description}</p>
          {a.connected && (
            <div className="mt-3 space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                <span>
                  I am a licensed customs broker and I have reviewed every line, classification and the declared value{declaredValueMinor != null ? ` (${formatMoney(declaredValueMinor, "USD")})` : ""}. {a.demonstration && "I understand this records a simulated reference and transmits nothing."}
                </span>
              </label>
              <button
                disabled={pending || !confirm || !ready}
                className={buttonClass("primary", "sm")}
                onClick={() => run(() => api<{ reference: string }>(`/customs/${entryId}/filing`, { body: { adapter: a.key, confirm } }), "Recorded.")}
              >
                Submit via {a.name}
              </button>
              {!ready && <p className="text-xs text-slate-500">Available once the file is marked ready to file.</p>}
            </div>
          )}
        </div>
      ))}
      <FormStatus error={error} ok={ok} />
    </div>
  );
}

export function EntryNotes({ entryId, notes }: { entryId: string; notes: string | null }) {
  const { pending, error, ok, run } = useSubmit();
  const [v, setV] = useState(notes ?? "");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api(`/customs/${entryId}`, { method: "PATCH", body: { brokerNotes: v } }), "Saved.");
      }}
    >
      <Field label="Broker notes (internal)">
        <textarea className="field" rows={3} value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
      <FormStatus error={error} ok={ok} />
      <Submit pending={pending} variant="secondary">
        Save notes
      </Submit>
    </form>
  );
}
