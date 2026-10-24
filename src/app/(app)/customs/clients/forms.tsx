"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { parseToMinor } from "@/lib/money";
import { buttonClass } from "@/components/ui";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

const money = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? parseToMinor(s) : null;
};
const date = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? new Date(`${s}T00:00:00Z`).toISOString() : null;
};
const text = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const dollars = (m: number | null | undefined) => (m != null ? (m / 100).toFixed(2) : "");

export function NewClientForm() {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-3 md:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () => api("/customs/clients", { body: { name: text(f.get("name")), iorNumber: text(f.get("ior")), entryFeeMinor: money(f.get("entryFee")), perLineFeeMinor: money(f.get("lineFee")), isfFeeMinor: money(f.get("isfFee")) } }),
          "Client added.",
          () => (e.target as HTMLFormElement).reset(),
        );
      }}
    >
      <Field label="Importer name" className="md:col-span-2">
        <input name="name" required className="field" />
      </Field>
      <Field label="Importer of record number" hint="Stored as entered and shown masked">
        <input name="ior" className="field" autoComplete="off" />
      </Field>
      <div />
      <Field label="Entry fee (USD)">
        <input name="entryFee" inputMode="decimal" className="field" />
      </Field>
      <Field label="Per-line fee (USD)">
        <input name="lineFee" inputMode="decimal" className="field" />
      </Field>
      <Field label="ISF fee (USD)">
        <input name="isfFee" inputMode="decimal" className="field" />
      </Field>
      <div className="flex items-end">
        <Submit pending={pending}>Add client</Submit>
      </div>
      <div className="md:col-span-4">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

interface ClientRow {
  id: string;
  status: string;
  iorNumber: string | null;
  bondType: string;
  bondNumber: string | null;
  suretyName: string | null;
  bondAmountMinor: number | null;
  bondExpiresAt: Date | null;
  bondSource: string;
  entryFeeMinor: number | null;
  perLineFeeMinor: number | null;
  isfFeeMinor: number | null;
  notes: string | null;
}

export function ClientProfileForm({ c }: { c: ClientRow }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-3 md:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () =>
            api(`/customs/clients/${c.id}`, {
              method: "PATCH",
              body: {
                status: f.get("status"),
                iorNumber: text(f.get("ior")),
                bondType: f.get("bondType"),
                bondNumber: text(f.get("bondNumber")),
                suretyName: text(f.get("surety")),
                bondAmountMinor: money(f.get("bondAmount")),
                bondExpiresAt: date(f.get("bondExpires")),
                bondSource: f.get("bondSource"),
                entryFeeMinor: money(f.get("entryFee")),
                perLineFeeMinor: money(f.get("lineFee")),
                isfFeeMinor: money(f.get("isfFee")),
                notes: text(f.get("notes")),
              },
            }),
          "Saved.",
        );
      }}
    >
      <Field label="Client status">
        <select name="status" defaultValue={c.status} className="field">
          <option value="ONBOARDING">Onboarding</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </Field>
      <Field label="Importer of record number">
        <input name="ior" defaultValue={c.iorNumber ?? ""} className="field" autoComplete="off" />
      </Field>
      <div />
      <Field label="Bond type">
        <select name="bondType" defaultValue={c.bondType} className="field">
          <option value="NONE">None recorded</option>
          <option value="SINGLE_TRANSACTION">Single transaction</option>
          <option value="CONTINUOUS">Continuous</option>
        </select>
      </Field>
      <Field label="Bond number">
        <input name="bondNumber" defaultValue={c.bondNumber ?? ""} className="field" />
      </Field>
      <Field label="Surety">
        <input name="surety" defaultValue={c.suretyName ?? ""} className="field" />
      </Field>
      <Field label="Bond amount (USD)">
        <input name="bondAmount" defaultValue={dollars(c.bondAmountMinor)} inputMode="decimal" className="field" />
      </Field>
      <Field label="Bond expires">
        <input name="bondExpires" type="date" defaultValue={ymd(c.bondExpiresAt)} className="field" />
      </Field>
      <Field label="Bond details source">
        <select name="bondSource" defaultValue={c.bondSource} className="field">
          <option value="SELF_REPORTED">Self-reported by importer</option>
          <option value="DOCUMENT_REVIEWED">Reviewed against bond document</option>
        </select>
      </Field>
      <Field label="Entry fee (USD)">
        <input name="entryFee" defaultValue={dollars(c.entryFeeMinor)} inputMode="decimal" className="field" />
      </Field>
      <Field label="Per-line fee (USD)">
        <input name="lineFee" defaultValue={dollars(c.perLineFeeMinor)} inputMode="decimal" className="field" />
      </Field>
      <Field label="ISF fee (USD)">
        <input name="isfFee" defaultValue={dollars(c.isfFeeMinor)} inputMode="decimal" className="field" />
      </Field>
      <Field label="Notes" className="md:col-span-3">
        <textarea name="notes" rows={2} defaultValue={c.notes ?? ""} className="field" />
      </Field>
      <div className="flex items-center gap-3 md:col-span-3">
        <Submit pending={pending} variant="secondary">
          Save profile
        </Submit>
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function PoaForm({ clientId, status, expiresAt, signedAt, documents, canApprove }: { clientId: string; status: string; expiresAt: Date | null; signedAt: Date | null; documents: { id: string; title: string }[]; canApprove: boolean }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api(`/customs/clients/${clientId}/poa`, { body: { status: f.get("status"), documentId: text(f.get("doc")), signedAt: date(f.get("signed")), expiresAt: date(f.get("expires")) } }), "Power of attorney updated.");
      }}
    >
      <Field label="Status">
        <select name="status" defaultValue={status} className="field">
          <option value="NONE">None on file</option>
          <option value="RECEIVED">Received, not verified</option>
          {canApprove && <option value="VERIFIED">Verified by licensed broker</option>}
          <option value="EXPIRED">Expired</option>
          <option value="REVOKED">Revoked</option>
        </select>
      </Field>
      <Field label="Signed document">
        <select name="doc" defaultValue="" className="field">
          <option value="">Keep current</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Signed on">
        <input name="signed" type="date" defaultValue={ymd(signedAt)} className="field" />
      </Field>
      <Field label="Expires">
        <input name="expires" type="date" defaultValue={ymd(expiresAt)} className="field" />
      </Field>
      <div className="flex items-center gap-3 md:col-span-2">
        <Submit pending={pending} variant="secondary">
          Update POA
        </Submit>
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function ClassificationDraftForm({ clientId }: { clientId: string }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () => api("/customs/classifications", { body: { clientId, partNumber: text(f.get("part")), description: text(f.get("desc")), htsCode: text(f.get("hts")), countryOfOrigin: text(f.get("coo")), rationale: text(f.get("why")) } }),
          "Draft saved. A licensed broker must approve it before it can be reused.",
          () => (e.target as HTMLFormElement).reset(),
        );
      }}
    >
      <input name="part" placeholder="Part number" aria-label="Part number" className="field" />
      <input name="desc" required placeholder="Product description" aria-label="Product description" className="field md:col-span-2" />
      <input name="hts" required placeholder="HTS 0000.00.0000" aria-label="HTS code" className="field font-mono" />
      <input name="coo" maxLength={2} placeholder="COO" aria-label="Country of origin" className="field uppercase" />
      <Submit pending={pending} variant="secondary">
        Save draft
      </Submit>
      <textarea name="why" rows={2} placeholder="Rationale (GRI applied, rulings consulted, notes for the next reviewer)" aria-label="Rationale" className="field md:col-span-6" />
      <div className="md:col-span-6">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

const MODES = ["OCEAN", "AIR", "TRUCK", "RAIL"] as const;

export function DeadlineRuleForm({ rule, canApprove }: { rule: { id: string; label: string; anchor: string; offsetDays: number; offsetHours: number; businessDays: boolean; modes: string[]; reference: string | null; enabled: boolean }; canApprove: boolean }) {
  const { pending, error, ok, run } = useSubmit();
  const [modes, setModes] = useState<string[]>(rule.modes);
  return (
    <form
      className="grid gap-2 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () =>
            api(`/customs/deadline-rules/${rule.id}`, {
              method: "PATCH",
              body: {
                label: text(f.get("label")),
                anchor: f.get("anchor"),
                offsetDays: Number(f.get("days") || 0),
                offsetHours: Number(f.get("hours") || 0),
                businessDays: f.get("business") === "on",
                modes,
                reference: text(f.get("reference")),
                enabled: f.get("enabled") === "on",
              },
            }),
          "Saved. Open deadlines were recomputed.",
        );
      }}
    >
      <Field label="Label" className="md:col-span-2">
        <input name="label" defaultValue={rule.label} disabled={!canApprove} className="field" />
      </Field>
      <Field label="Counted from">
        <select name="anchor" defaultValue={rule.anchor} disabled={!canApprove} className="field">
          <option value="VESSEL_DEPARTURE">Vessel departure</option>
          <option value="ARRIVAL">Arrival</option>
          <option value="RELEASE">Release</option>
          <option value="ENTRY_OPENED">File opened</option>
        </select>
      </Field>
      <Field label="Days">
        <input name="days" type="number" defaultValue={rule.offsetDays} disabled={!canApprove} className="field" />
      </Field>
      <Field label="Hours">
        <input name="hours" type="number" defaultValue={rule.offsetHours} disabled={!canApprove} className="field" />
      </Field>
      <div className="flex flex-col justify-end gap-1 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="business" defaultChecked={rule.businessDays} disabled={!canApprove} /> Business days
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="enabled" defaultChecked={rule.enabled} disabled={!canApprove} /> Enabled
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3 text-sm md:col-span-6">
        <legend className="sr-only">Modes</legend>
        <span className="text-xs text-slate-500">Applies to:</span>
        {MODES.map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input type="checkbox" disabled={!canApprove} checked={modes.includes(m)} onChange={(e) => setModes(e.target.checked ? [...modes, m] : modes.filter((x) => x !== m))} /> {m.toLowerCase()}
          </label>
        ))}
        <span className="text-xs text-slate-400">(none checked = all modes)</span>
      </fieldset>
      <Field label="Reference shown to staff" className="md:col-span-6">
        <input name="reference" defaultValue={rule.reference ?? ""} disabled={!canApprove} className="field" />
      </Field>
      {canApprove && (
        <div className="flex items-center gap-3 md:col-span-6">
          <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
            {pending ? "Saving…" : "Save rule"}
          </button>
          <FormStatus error={error} ok={ok} />
        </div>
      )}
    </form>
  );
}
