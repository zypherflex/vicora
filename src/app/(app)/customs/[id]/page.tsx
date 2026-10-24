import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, DemoBadge, Empty, KV, Notice, NotConnected, StatusBadge, Table, Td } from "@/components/ui";
import { categoryLabel } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { load } from "@/server/page";
import { getCustomsFile } from "@/server/services/customs";
import { DocRequestForm, DownloadButton, UploadForm } from "../../shipments/[id]/forms";
import { CustomsStatusControl, EntryNotes, ExtractionReview, FilingPanel, LineForm, TaskDone } from "./forms";

export const metadata: Metadata = { title: "Customs file" };

const NEXT: Record<string, string[]> = {
  INTAKE: ["DOCS_PENDING"],
  DOCS_PENDING: ["IN_REVIEW", "HOLD"],
  IN_REVIEW: ["DOCS_PENDING", "READY_TO_FILE", "HOLD"],
  READY_TO_FILE: ["IN_REVIEW", "HOLD"],
  SUBMITTED: ["RELEASED", "HOLD"],
  HOLD: ["IN_REVIEW", "RELEASED", "DOCS_PENDING"],
  RELEASED: ["CLOSED"],
  CLOSED: [],
};

export default async function CustomsFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { f, tz, perms } = await load(async (ctx) => ({ f: await getCustomsFile(ctx, id), tz: ctx.org.timezone, perms: ctx.perms }), { need: "customs.read" });
  const canManage = perms.has("customs.manage") && f.isBroker;
  const canApprove = perms.has("customs.approve") && f.isBroker;
  const e = f.entry;
  const s = f.shipment;
  const docName = (docId: string) => f.documents.find((d) => d.id === docId);
  const options = (NEXT[e.status] ?? []).filter((o) => canApprove || !["READY_TO_FILE", "RELEASED"].includes(o));
  const pendingReview = f.extractions.filter((x) => x.status === "COMPLETED" && x.reviewStatus === "PENDING_REVIEW");
  const extractable = f.documents.filter((d) => ["COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "ARRIVAL_NOTICE"].includes(d.category));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Customs file · {s.reference}</h1>
            <StatusBadge status={e.status} />
            {s.isDemo && <DemoBadge />}
            {e.filingAdapter === "DEMO" ? <Badge tone="violet">Demo filing {e.filingReference}</Badge> : <NotConnected what="CBP ACE" />}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {e.importerName ?? "Importer"} · {e.portOfEntry ?? s.portOfEntry ?? "port TBD"} · container {s.containerNumber ?? "—"} ·{" "}
            <Link className="text-brand-600 hover:underline" href={`/shipments/${s.id}`}>
              shipment timeline
            </Link>
          </p>
        </div>
        {canManage && <CustomsStatusControl entryId={e.id} options={options} />}
      </div>

      <Notice tone="amber">
        Vicora organizes documents and highlights inconsistencies. Extracted values, suggestions and discrepancy flags are aids for the licensed broker; they are not classifications, valuations or customs determinations.
      </Notice>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {f.discrepancies.length > 0 && (
            <Card title={`Discrepancies (${f.discrepancies.length})`}>
              <ul className="space-y-3">
                {f.discrepancies.map((d) => (
                  <li key={d.field} className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm">
                    <p className="font-medium">
                      {d.label} <Badge tone={d.severity === "warning" ? "amber" : "slate"}>{d.severity}</Badge>
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {d.values.map((v, i) => (
                        <li key={i}>
                          <strong>{v.value}</strong> · {v.source}
                          {v.snippet && <span className="text-slate-500"> · “{v.snippet}”</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-slate-600">{d.explanation}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {f.isBroker && (
            <Card title="AI-assisted extraction">
              {extractable.length === 0 ? (
                <p className="text-sm text-slate-500">Upload a commercial invoice, packing list or bill of lading to extract fields.</p>
              ) : (
                <ul className="mb-4 space-y-1 text-sm">
                  {extractable.map((d) => {
                    const ex = f.extractions.filter((x) => x.documentId === d.id);
                    const latest = ex[0];
                    return (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {d.title} <span className="text-xs text-slate-500">({categoryLabel(d.category)})</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {latest && (
                            <>
                              <StatusBadge status={latest.status === "COMPLETED" ? latest.reviewStatus.replace("PENDING_REVIEW", "PENDING") : latest.status === "FAILED" ? "REJECTED" : "PENDING"} label={latest.status === "COMPLETED" ? latest.reviewStatus.replace("_", " ").toLowerCase() : latest.status.toLowerCase()} />
                              <span className="text-xs text-slate-500">
                                {latest.engine === "demo-rules" ? "demo engine" : latest.engine} · {relativeTime(latest.createdAt)}
                              </span>
                            </>
                          )}
                          {canManage && (
                            <ActionButton path={`/documents/${d.id}/extractions`} variant="ghost">
                              {latest ? "Re-run" : "Extract"}
                            </ActionButton>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {pendingReview.map((x) => (
                <div key={x.id} className="mt-4 border-t border-slate-100 pt-4">
                  <p className="mb-2 text-sm font-semibold">
                    Review: {docName(x.documentId)?.title} <Badge tone="violet">{x.engine === "demo-rules" ? "Demo extraction engine" : "AI extraction"}</Badge>
                  </p>
                  <ExtractionReview extractionId={x.id} fields={x.fields} warnings={x.warnings} canApprove={canApprove} />
                </div>
              ))}
            </Card>
          )}

          <Card title="Entry lines" pad={false}>
            {f.lines.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No lines yet. Classification (HTS) is entered and reviewed by the broker.</div>
            ) : (
              <Table head={["Description", "HTS", "Qty", "Value", "COO", "Reviewed"]}>
                {f.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-normal">{l.description}</Td>
                    <Td className="font-mono">{l.htsCode ?? "—"}</Td>
                    <Td>{l.quantity ?? "—"}</Td>
                    <Td>{l.valueMinor != null ? formatMoney(l.valueMinor, e.currency ?? "USD") : "—"}</Td>
                    <Td>{l.countryOfOrigin ?? "—"}</Td>
                    <Td>{l.brokerReviewed ? <Badge tone="green">Reviewed</Badge> : <Badge tone="amber">Pending</Badge>}</Td>
                  </tr>
                ))}
              </Table>
            )}
            {canManage && !["SUBMITTED", "RELEASED", "CLOSED"].includes(e.status) && (
              <div className="space-y-3 border-t border-slate-100 p-4">
                {f.lines.map((l) => (
                  <details key={l.id} className="text-sm">
                    <summary className="cursor-pointer text-slate-600">Edit: {l.description}</summary>
                    <div className="mt-2">
                      <LineForm entryId={e.id} canApprove={canApprove} line={l} />
                    </div>
                  </details>
                ))}
                <p className="text-sm font-medium">Add line</p>
                <LineForm entryId={e.id} canApprove={canApprove} />
              </div>
            )}
          </Card>

          <Card title="Documents" pad={false}>
            {f.documents.length === 0 ? (
              <div className="p-4">
                <Empty title="No documents" />
              </div>
            ) : (
              <Table head={["Document", "Category", "Uploaded", ""]}>
                {f.documents.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.title}</Td>
                    <Td>{categoryLabel(d.category)}</Td>
                    <Td className="text-xs">{formatInTimeZone(d.createdAt, tz)}</Td>
                    <Td>{d.version && !d.version.purgedAt && <DownloadButton versionId={d.version.id} />}</Td>
                  </tr>
                ))}
              </Table>
            )}
            {canManage && (
              <div className="space-y-4 border-t border-slate-100 p-4">
                <UploadForm shipmentId={s.id} canInternal />
                <DocRequestForm shipmentId={s.id} />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Entry summary">
            <KV
              items={[
                ["Declared value", e.declaredValueMinor != null ? formatMoney(e.declaredValueMinor, e.currency ?? "USD") : "Not set"],
                ["Country of origin", e.countryOfOrigin],
                ["Gross weight", e.grossWeightKg ? `${e.grossWeightKg.toLocaleString()} kg` : null],
                ["Arrival", e.arrivalAt ? formatInTimeZone(e.arrivalAt, tz, { dateOnly: true }) : s.portEta ? formatInTimeZone(s.portEta, tz, { dateOnly: true }) : null],
                ["Filing", e.filingReference ? `${e.filingReference} (${e.filingAdapter === "DEMO" ? "demo" : e.filingAdapter})` : "Not filed"],
              ]}
            />
            <p className="mt-2 text-xs text-slate-500">Values here change only through broker-approved extractions or manual edits, and every change is audited.</p>
          </Card>
          <Card title="Document checklist">
            <ul className="space-y-1 text-sm">
              {f.requirements.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  {categoryLabel(r.category)} <StatusBadge status={r.status === "REQUESTED" ? "PENDING" : "APPROVED"} label={r.status.toLowerCase()} />
                </li>
              ))}
              {f.requirements.length === 0 && <li className="text-slate-500">No requirements.</li>}
            </ul>
          </Card>
          {f.tasks.length > 0 && (
            <Card title="Tasks">
              <ul className="space-y-2 text-sm">
                {f.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className={t.status === "DONE" ? "text-slate-400 line-through" : ""}>{t.title}</span>
                    {t.status === "OPEN" && <TaskDone id={t.id} />}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {f.isBroker && (
            <Card title="Filing">
              <FilingPanel entryId={e.id} adapters={f.filingAdapters} ready={e.status === "READY_TO_FILE" && canApprove} declaredValueMinor={e.declaredValueMinor} />
            </Card>
          )}
          {canManage && (
            <Card title="Notes">
              <EntryNotes entryId={e.id} notes={e.brokerNotes} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
