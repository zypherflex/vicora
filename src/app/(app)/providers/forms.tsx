"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { parseToMinor } from "@/lib/money";
import { buttonClass } from "@/components/ui";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

const TYPES = [
  ["OPERATING_AUTHORITY", "Operating authority (MC)"],
  ["USDOT_REGISTRATION", "USDOT registration"],
  ["AUTO_LIABILITY_INSURANCE", "Auto liability insurance"],
  ["CARGO_INSURANCE", "Cargo insurance"],
  ["CUSTOMS_LICENSE", "Customs broker license"],
  ["W9", "W-9"],
] as const;

export function ComplianceRecordForm() {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 md:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => ((f.get(k) as string) ?? "").trim();
        run(async () => {
          let documentId: string | null = null;
          const file = f.get("file") as File | null;
          if (file && file.size) {
            const form = new FormData();
            form.set("file", file);
            form.set("category", v("type") === "OPERATING_AUTHORITY" ? "OPERATING_AUTHORITY" : v("type").includes("INSURANCE") ? "INSURANCE_CERTIFICATE" : "OTHER");
            form.set("title", v("type"));
            form.set("visibility", "SHARED");
            documentId = (await api<{ documentId: string }>("/org/documents", { form })).documentId;
          }
          return api("/compliance", {
            body: {
              type: v("type"),
              identifier: v("identifier") || null,
              coverageMinor: v("coverage") ? parseToMinor(v("coverage")) : null,
              effectiveDate: v("effective") ? new Date(v("effective")).toISOString() : null,
              expiresAt: v("expires") ? new Date(v("expires")).toISOString() : null,
              documentId,
              notes: v("notes") || null,
            },
          });
        }, "Saved. It shows as not verified until a reviewer checks the document.", () => (e.target as HTMLFormElement).reset());
      }}
    >
      <Field label="Record">
        <select name="type" className="field">
          {TYPES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Number / policy">
        <input name="identifier" className="field" />
      </Field>
      <Field label="Coverage (USD)">
        <input name="coverage" inputMode="decimal" className="field" />
      </Field>
      <Field label="Effective">
        <input name="effective" type="date" className="field" />
      </Field>
      <Field label="Expires">
        <input name="expires" type="date" className="field" />
      </Field>
      <Field label="Supporting document">
        <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" className="block w-full text-sm" />
      </Field>
      <Field label="Notes" className="md:col-span-2">
        <input name="notes" className="field" />
      </Field>
      <div className="flex items-end">
        <Submit pending={pending}>Add record</Submit>
      </div>
      <div className="md:col-span-3">
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function VerifyRecord({ id, hasDocument, isDemoSubject }: { id: string; hasDocument: boolean; isDemoSubject: boolean }) {
  const { pending, error, run } = useSubmit();
  const [method, setMethod] = useState(hasDocument ? "MANUAL_DOCUMENT_REVIEW" : isDemoSubject ? "DEMO_ADAPTER" : "MANUAL_DOCUMENT_REVIEW");
  return (
    <span className="flex flex-wrap items-center gap-1">
      <select className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Verification method">
        <option value="MANUAL_DOCUMENT_REVIEW" disabled={!hasDocument}>
          Manual document review
        </option>
        {isDemoSubject && <option value="DEMO_ADAPTER">Demo adapter</option>}
      </select>
      <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => api(`/compliance/${id}/verify`, { body: { result: "VERIFIED", method } }))}>
        Verify
      </button>
      <button disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => api(`/compliance/${id}/verify`, { body: { result: "REJECTED", method } }))}>
        Reject
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
