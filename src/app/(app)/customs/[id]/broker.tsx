"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { ENTRY_TYPES } from "@/lib/customs";
import { Badge, buttonClass, Notice } from "@/components/ui";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

const toLocal = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16) : "");
const fromLocal = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? new Date(`${s}:00Z`).toISOString() : null;
};

export function EntryDetailsForm({
  entry,
  clients,
}: {
  entry: { id: string; entryNumber: string | null; entryType: string | null; modeOfTransport: string; vesselDepartureAt: Date | null; arrivalAt: Date | null; releasedAt: Date | null; clientId: string | null };
  clients: { id: string; name: string }[];
}) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () =>
            api(`/customs/${entry.id}/details`, {
              method: "PATCH",
              body: {
                entryNumber: String(f.get("entryNumber") ?? "").trim(),
                entryType: f.get("entryType") || null,
                modeOfTransport: f.get("mode"),
                vesselDepartureAt: fromLocal(f.get("departure")),
                arrivalAt: fromLocal(f.get("arrival")),
                releasedAt: fromLocal(f.get("released")),
                clientId: f.get("clientId") || null,
              },
            }),
          "Saved. Deadlines recomputed.",
        );
      }}
    >
      <Field label="Client" className="sm:col-span-2">
        <select name="clientId" defaultValue={entry.clientId ?? ""} className="field">
          <option value="">Not linked</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Entry number" hint="Filer code-serial-check digit">
        <input name="entryNumber" defaultValue={entry.entryNumber ?? ""} placeholder="XXX-1234567-8" className="field font-mono" />
      </Field>
      <Field label="Entry type">
        <select name="entryType" defaultValue={entry.entryType ?? ""} className="field">
          <option value="">Not set</option>
          {ENTRY_TYPES.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Mode of transport">
        <select name="mode" defaultValue={entry.modeOfTransport} className="field">
          <option value="OCEAN">Ocean</option>
          <option value="AIR">Air</option>
          <option value="TRUCK">Truck</option>
          <option value="RAIL">Rail</option>
        </select>
      </Field>
      <Field label="Vessel departure (UTC)">
        <input name="departure" type="datetime-local" defaultValue={toLocal(entry.vesselDepartureAt)} className="field" />
      </Field>
      <Field label="Arrival (UTC)">
        <input name="arrival" type="datetime-local" defaultValue={toLocal(entry.arrivalAt)} className="field" />
      </Field>
      <Field label="Release (UTC)">
        <input name="released" type="datetime-local" defaultValue={toLocal(entry.releasedAt)} className="field" />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Submit pending={pending} variant="secondary">
          Save details
        </Submit>
        <FormStatus error={error} ok={ok} />
      </div>
    </form>
  );
}

export function ResolveFinding({ entryId, findingId, blocker, canApprove }: { entryId: string; findingId: string; blocker: boolean; canApprove: boolean }) {
  const { pending, error, run } = useSubmit();
  const [note, setNote] = useState("");
  if (blocker && !canApprove) return <p className="text-xs text-slate-500">A licensed broker must clear this blocker.</p>;
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} className="field max-w-sm flex-1 text-sm" placeholder={blocker ? "Why is this acceptable? (required)" : "Note (optional)"} aria-label="Resolution note" />
      <button
        disabled={pending || (blocker && !note.trim())}
        className={buttonClass("secondary", "sm")}
        onClick={() => run(() => api(`/customs/${entryId}/review/findings`, { body: { findingId, status: "RESOLVED", note: note.trim() || null } }))}
      >
        Mark resolved
      </button>
      {!blocker && (
        <button disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => api(`/customs/${entryId}/review/findings`, { body: { findingId, status: "ACKNOWLEDGED", note: note.trim() || null } }))}>
          Acknowledge
        </button>
      )}
      <FormStatus error={error} />
    </div>
  );
}

interface LineItem {
  partNumber: string | null;
  description: string;
  quantity: number | null;
  unitPrice: string | null;
  amount: string | null;
  countryOfOrigin: string | null;
  source: { page: number | null; snippet: string };
}

export function ExtractedLines({ entryId, extractionId, items, existingParts }: { entryId: string; extractionId: string; items: LineItem[]; existingParts: string[] }) {
  const { pending, error, ok, run } = useSubmit();
  const [picked, setPicked] = useState<number[]>(items.map((it, i) => (it.partNumber && existingParts.includes(it.partNumber.toUpperCase()) ? -1 : i)).filter((i) => i >= 0));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="px-2 py-1" />
              <th className="px-2 py-1">Part</th>
              <th className="px-2 py-1">Description</th>
              <th className="px-2 py-1">Qty</th>
              <th className="px-2 py-1">Amount</th>
              <th className="px-2 py-1">COO</th>
              <th className="px-2 py-1">Source</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const dup = !!it.partNumber && existingParts.includes(it.partNumber.toUpperCase());
              return (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1">
                    <input type="checkbox" aria-label={`Use line ${i + 1}`} checked={picked.includes(i)} onChange={(e) => setPicked(e.target.checked ? [...picked, i] : picked.filter((x) => x !== i))} />
                  </td>
                  <td className="px-2 py-1 font-mono text-xs">
                    {it.partNumber ?? "—"} {dup && <Badge>already a line</Badge>}
                  </td>
                  <td className="px-2 py-1">{it.description}</td>
                  <td className="px-2 py-1 tabular-nums">{it.quantity ?? "—"}</td>
                  <td className="px-2 py-1 tabular-nums">{it.amount ?? "—"}</td>
                  <td className="px-2 py-1">{it.countryOfOrigin ?? "—"}</td>
                  <td className="max-w-xs p-1 font-mono text-xs text-slate-500">
                    {it.source.page ? `p.${it.source.page} ` : ""}“{it.source.snippet}”
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || !picked.length} className={buttonClass("primary", "sm")} onClick={() => run(() => api<{ created: number; prefilled: number }>(`/customs/${entryId}/extractions/${extractionId}/lines`, { body: { indexes: picked } }), "Draft lines created. Review each one before filing.")}>
          Create {picked.length} draft line{picked.length === 1 ? "" : "s"}
        </button>
        <FormStatus error={error} ok={ok} />
      </div>
      <p className="text-xs text-slate-500">Lines are created unreviewed. A part number that matches an approved classification in this client&apos;s library pre-fills the HTS number as precedent; the broker still reviews every line.</p>
    </div>
  );
}

interface AssistResult {
  precedents: { item: { id: string; partNumber: string | null; description: string; htsCode: string; countryOfOrigin: string | null; rationale: string | null }; score: number; reasons: string[] }[];
  ai: { engine: string; candidates: { htsCode: string; rationale: string; confidence: number }[]; questions: string[]; note: string };
}

export function ClassifyAssist({ entryId, line, clientId }: { entryId: string; line: { id: string; description: string; partNumber: string | null; countryOfOrigin: string | null }; clientId: string | null }) {
  const { pending, error, ok, run } = useSubmit();
  const [res, setRes] = useState<AssistResult | null>(null);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 text-sm">
      {!res ? (
        <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => api<AssistResult>(`/customs/${entryId}/lines/${line.id}/assist`, { body: {} }), undefined, (r) => setRes(r as AssistResult))}>
          {pending ? "Looking…" : "Classification assist"}
        </button>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="font-medium">Precedents from this client&apos;s approved library</p>
            {res.precedents.length === 0 ? (
              <p className="text-xs text-slate-500">{clientId ? "No similar approved classifications." : "Link the entry to a client to search its library."}</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {res.precedents.map((p) => (
                  <li key={p.item.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-slate-200 bg-white p-2">
                    <div>
                      <p>
                        <span className="font-mono">{p.item.htsCode}</span> · {p.item.partNumber && <span className="font-mono text-xs">{p.item.partNumber} · </span>}
                        {p.item.description}
                      </p>
                      <p className="text-xs text-slate-500">
                        Match {Math.round(p.score * 100)}% · {p.reasons.join(" · ")}
                      </p>
                      {p.item.rationale && <p className="text-xs text-slate-500">Rationale: {p.item.rationale}</p>}
                    </div>
                    <button disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => api(`/customs/${entryId}/lines/${line.id}/classification`, { body: { classificationItemId: p.item.id } }), "Applied. The line needs broker review again.")}>
                      Use this precedent
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="flex items-center gap-2 font-medium">
              AI candidates <Badge tone="amber">Unverified</Badge>
            </p>
            <p className="text-xs text-slate-500">{res.ai.note}</p>
            {res.ai.candidates.length > 0 && (
              <ul className="mt-1 space-y-2">
                {res.ai.candidates.map((c) => (
                  <li key={c.htsCode} className="rounded border border-amber-200 bg-white p-2">
                    <p>
                      <span className="font-mono">{c.htsCode}</span> <span className="text-xs text-slate-500">model confidence {Math.round(c.confidence * 100)}%</span>
                    </p>
                    <p className="text-xs text-slate-600">{c.rationale}</p>
                    {clientId && (
                      <button
                        disabled={pending}
                        className={`${buttonClass("ghost", "sm")} mt-1`}
                        onClick={() =>
                          run(
                            () => api("/customs/classifications", { body: { clientId, partNumber: line.partNumber, description: line.description, htsCode: c.htsCode, countryOfOrigin: line.countryOfOrigin, rationale: `AI candidate, pending broker verification: ${c.rationale}`.slice(0, 2000), source: "AI_SUGGESTION" } }),
                            "Saved to the client library as a draft for a licensed broker to verify.",
                          )
                        }
                      >
                        Save as draft for broker verification
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {res.ai.questions.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium">Facts that would decide between candidates</p>
                <ul className="list-disc pl-5 text-xs text-slate-600">
                  {res.ai.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <FormStatus error={error} ok={ok} />
        </div>
      )}
      {!res && <FormStatus error={error} />}
    </div>
  );
}

export function AskFile({ entryId }: { entryId: string }) {
  const { pending, error, run } = useSubmit();
  const [q, setQ] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!q.trim()) return;
        run(() => api(`/customs/${entryId}/questions`, { body: { question: q.trim() } }), undefined, () => setQ(""));
      }}
    >
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="field flex-1" placeholder="e.g. What is the invoice total and who is the seller?" aria-label="Question about this file" />
        <Submit pending={pending}>Ask</Submit>
      </div>
      <FormStatus error={error} />
    </form>
  );
}

export function DutyNote() {
  return (
    <Notice tone="amber">
      Estimate only: the sum of each line&apos;s value times the duty rate a broker entered on that line. It is not a CBP duty determination and excludes MPF, HMF, AD/CVD, Section 301 and other fees unless the broker included them in the rate.
    </Notice>
  );
}
