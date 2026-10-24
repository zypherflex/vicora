import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, DemoBadge, Empty, KV, Notice, NotConnected, StatusBadge, Table, Td } from "@/components/ui";
import { ENTRY_TYPES } from "@/lib/customs";
import { categoryLabel } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { load } from "@/server/page";
import { getCustomsFile } from "@/server/services/customs";
import { DocRequestForm, DownloadButton, UploadForm } from "../../shipments/[id]/forms";
import { scoreTone, STATE_LABEL, STATE_TONE } from "../shared";
import { AskFile, ClassifyAssist, DutyNote, EntryDetailsForm, ExtractedLines, ResolveFinding } from "./broker";
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
  const { f, tz, perms, now } = await load(async (ctx) => ({ f: await getCustomsFile(ctx, id), tz: ctx.org.timezone, perms: ctx.perms, now: new Date() }), { need: "customs.read" });
  const canManage = perms.has("customs.manage") && f.isBroker;
  const canApprove = perms.has("customs.approve") && f.isBroker;
  const e = f.entry;
  const s = f.shipment;
  const docName = (docId: string) => f.documents.find((d) => d.id === docId);
  const options = (NEXT[e.status] ?? []).filter((o) => canApprove || !["READY_TO_FILE", "RELEASED"].includes(o));
  const pendingReview = f.extractions.filter((x) => x.status === "COMPLETED" && x.reviewStatus === "PENDING_REVIEW");
  const ins = f.insights;
  const canAi = perms.has("ai.use") && f.isBroker;
  const locked = ["SUBMITTED", "RELEASED", "CLOSED"].includes(e.status);
  const review = ins.review;
  const openBlockers = review ? review.findings.filter((x) => x.severity === "BLOCKER" && !x.resolution) : [];
  const withItems = f.extractions.filter((x) => x.status === "COMPLETED" && x.lineItems.length > 0).filter((x, i, a) => a.findIndex((y) => y.documentId === x.documentId) === i);
  const existingParts = f.lines.map((l) => l.partNumber?.toUpperCase()).filter((p): p is string => !!p);
  const deadlineState = (d: { dueAt: Date; status: string }) => (d.status !== "OPEN" ? "done" : d.dueAt < now ? "overdue" : d.dueAt.getTime() - now.getTime() < 48 * 3600_000 ? "due_soon" : "upcoming");
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
            {ins.client ? (
              <Link className="text-brand-600 hover:underline" href={`/customs/clients/${ins.client.id}`}>
                {ins.client.name}
              </Link>
            ) : (
              (e.importerName ?? "Importer")
            )}{" "}
            · entry {e.entryNumber ?? "number not set"} · {e.modeOfTransport.toLowerCase()} · {e.portOfEntry ?? s.portOfEntry ?? "port TBD"} · container {s.containerNumber ?? "—"} ·{" "}
            <Link className="text-brand-600 hover:underline" href={`/shipments/${s.id}`}>
              shipment timeline
            </Link>
          </p>
        </div>
        {canManage && <CustomsStatusControl entryId={e.id} options={options} />}
      </div>

      <Notice tone="amber">
        Vicora prepares and checks the file: it extracts values with their source text, runs a pre-filing review, finds precedent in the client&apos;s approved library and answers questions from the file with citations. All of it is an aid for the licensed broker. None of it is a classification, valuation, admissibility or duty determination, and nothing is filed without a licensed broker&apos;s confirmation.
      </Notice>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          {f.isBroker && (
            <Card
              title="Pre-filing review"
              actions={
                canManage && !locked ? (
                  <ActionButton path={`/customs/${e.id}/review`} variant={review && ins.reviewCurrent ? "ghost" : "primary"}>
                    {review ? "Run again" : "Run pre-filing review"}
                  </ActionButton>
                ) : undefined
              }
            >
              {!review ? (
                <p className="text-sm text-slate-500">
                  The review checks documents, extractions, every line, values against the commercial invoice, the client&apos;s POA and bond, deadlines and consistency with the client&apos;s classification library{canAi ? ", then adds AI observations that quote the file" : ""}. It must be clear before the file can be marked ready to file.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={scoreTone(review.score)}>Readiness {review.score}/100</Badge>
                    {openBlockers.length > 0 ? <Badge tone="red">{openBlockers.length} open blocker{openBlockers.length > 1 ? "s" : ""}</Badge> : <Badge tone="green">No open blockers</Badge>}
                    {!ins.reviewCurrent && <Badge tone="amber">File changed since this review</Badge>}
                    <span className="text-xs text-slate-500">
                      {review.engine === "rules" ? "Rule checks" : `Rule checks + ${review.engine.replace("rules+", "")}`} · {relativeTime(review.createdAt)}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {review.findings.map((x) => (
                      <li key={x.id} className={`rounded-md border p-3 text-sm ${x.resolution ? "border-slate-200 opacity-70" : x.severity === "BLOCKER" ? "border-red-200 bg-red-50/50" : x.severity === "WARNING" ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}`} data-finding={x.code}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={x.severity === "BLOCKER" ? "red" : x.severity === "WARNING" ? "amber" : "slate"}>{x.severity.toLowerCase()}</Badge>
                          <Badge tone={x.origin === "AI" ? "violet" : "slate"}>{x.origin === "AI" ? "AI observation" : "Rule"}</Badge>
                          <span className="font-medium">{x.title}</span>
                          {x.resolution && <Badge tone="green">{x.resolution.status.toLowerCase()}</Badge>}
                        </div>
                        <p className="mt-1 text-slate-700">{x.detail}</p>
                        {x.evidence.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                            {x.evidence.map((ev, i) => (
                              <li key={i}>
                                {ev.label}
                                {ev.snippet && <span className="font-mono"> · “{ev.snippet}”</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {x.resolution?.note && <p className="mt-1 text-xs text-slate-600">Note: {x.resolution.note}</p>}
                        {!x.resolution && canManage && !locked && x.severity !== "INFO" && <ResolveFinding entryId={e.id} findingId={x.id} blocker={x.severity === "BLOCKER"} canApprove={canApprove} />}
                      </li>
                    ))}
                    {review.findings.length === 0 && <li className="text-sm text-emerald-700">No findings.</li>}
                  </ul>
                </div>
              )}
            </Card>
          )}

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
              {canManage &&
                !locked &&
                withItems.map((x) => (
                  <div key={`items-${x.id}`} className="mt-4 border-t border-slate-100 pt-4">
                    <p className="mb-2 text-sm font-semibold">
                      Invoice line items: {docName(x.documentId)?.title} <Badge tone="violet">{x.lineItems.length} found</Badge>
                    </p>
                    <ExtractedLines entryId={e.id} extractionId={x.id} items={x.lineItems} existingParts={existingParts} />
                  </div>
                ))}
            </Card>
          )}

          <Card title="Entry lines" pad={false}>
            {f.lines.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No lines yet. Create draft lines from an extracted commercial invoice, or add them by hand. Classification is the licensed broker&apos;s decision.</div>
            ) : (
              <Table head={["#", "Part / description", "HTS", "Qty", "Value", "COO", "Duty rate", "Reviewed"]}>
                {[...f.lines]
                  .sort((a, b) => a.lineNumber - b.lineNumber)
                  .map((l) => {
                    const lib = l.classificationItemId ? ins.library.find((i) => i.id === l.classificationItemId) : undefined;
                    return (
                      <tr key={l.id}>
                        <Td className="tabular-nums text-slate-500">{l.lineNumber || "—"}</Td>
                        <Td className="whitespace-normal">
                          {l.partNumber && <span className="font-mono text-xs text-slate-500">{l.partNumber} · </span>}
                          {l.description}
                        </Td>
                        <Td className="font-mono">
                          {l.htsCode ?? "—"}
                          {lib && (
                            <p>
                              <Badge tone="blue" title="Matches an approved classification in this client's library">
                                library precedent
                              </Badge>
                            </p>
                          )}
                        </Td>
                        <Td className="tabular-nums">{l.quantity?.toLocaleString() ?? "—"}</Td>
                        <Td className="tabular-nums">{l.valueMinor != null ? formatMoney(l.valueMinor, e.currency ?? "USD") : "—"}</Td>
                        <Td>{l.countryOfOrigin ?? "—"}</Td>
                        <Td className="tabular-nums">{l.dutyRateBp != null ? `${(l.dutyRateBp / 100).toFixed(2)}%` : "—"}</Td>
                        <Td>{l.brokerReviewed ? <Badge tone="green">Reviewed</Badge> : <Badge tone="amber">Pending</Badge>}</Td>
                      </tr>
                    );
                  })}
              </Table>
            )}
            {canManage && !locked && (
              <div className="space-y-3 border-t border-slate-100 p-4">
                {[...f.lines]
                  .sort((a, b) => a.lineNumber - b.lineNumber)
                  .map((l) => (
                    <details key={l.id} className="text-sm">
                      <summary className="cursor-pointer text-slate-600">
                        Line {l.lineNumber || "—"}: {l.description}
                      </summary>
                      <div className="mt-2 space-y-2">
                        <LineForm entryId={e.id} canApprove={canApprove} line={l} />
                        <ClassifyAssist entryId={e.id} line={l} clientId={e.clientId} />
                        {canApprove && l.brokerReviewed && l.htsCode && !l.classificationItemId && e.clientId && (
                          <ActionButton path={`/customs/${e.id}/lines/${l.id}/library`} body={{ rationale: null }} variant="ghost">
                            Save to client library as approved precedent
                          </ActionButton>
                        )}
                      </div>
                    </details>
                  ))}
                <p className="text-sm font-medium">Add line</p>
                <LineForm entryId={e.id} canApprove={canApprove} />
              </div>
            )}
          </Card>

          {f.isBroker && canAi && (
            <Card title="Ask this file">
              <p className="mb-2 text-xs text-slate-500">Answers come only from this file&apos;s documents, extractions, lines, client record and deadlines, with a quote for each claim. If the file does not say, the answer says so.</p>
              <AskFile entryId={e.id} />
              {ins.questions.length > 0 && (
                <ul className="mt-3 space-y-3">
                  {ins.questions.map((q) => (
                    <li key={q.id} className="rounded-md border border-slate-200 p-3 text-sm">
                      <p className="font-medium">{q.question}</p>
                      <p className="mt-1 whitespace-pre-line text-slate-700">{q.answer}</p>
                      {q.citations.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                          {q.citations.map((c, i) => (
                            <li key={i}>
                              [{i + 1}] {c.label}: <span className="font-mono">“{c.snippet}”</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-slate-400">
                        {q.engine === "demo-rules" ? "Demonstration engine (keyword retrieval)" : "Claude"} · {relativeTime(q.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

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
          {f.isBroker && (
            <Card title="Deadlines">
              {ins.deadlines.length === 0 ? (
                <p className="text-sm text-slate-500">Add the vessel departure, arrival or release date below to compute deadlines.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {ins.deadlines.map((d) => {
                    const st = deadlineState(d);
                    return (
                      <li key={d.id} className="rounded-md border border-slate-200 p-2" data-deadline={d.ruleKey}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{d.label}</p>
                            <p className="text-xs text-slate-500">{formatInTimeZone(d.dueAt, tz)}</p>
                          </div>
                          <Badge tone={STATE_TONE[st]}>{d.status === "OPEN" ? STATE_LABEL[st] : d.status.toLowerCase()}</Badge>
                        </div>
                        {d.reference && <p className="mt-1 text-xs text-slate-500">{d.reference}</p>}
                        {canManage && d.status === "OPEN" && (
                          <div className="mt-1 flex gap-2">
                            <ActionButton path={`/customs/deadlines/${d.id}`} method="PATCH" body={{ status: "MET" }} variant="ghost">
                              Mark met
                            </ActionButton>
                            {canApprove && (
                              <ActionButton path={`/customs/deadlines/${d.id}`} method="PATCH" body={{ status: "WAIVED", note: "Not applicable to this entry" }} variant="ghost" confirm="Waive this deadline for this entry?">
                                Waive
                              </ActionButton>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canManage && (
                <details className="mt-3 border-t border-slate-100 pt-3" open={!e.arrivalAt && !e.vesselDepartureAt}>
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">Entry details and key dates</summary>
                  <div className="mt-2">
                    <EntryDetailsForm entry={e} clients={ins.clients} />
                  </div>
                </details>
              )}
            </Card>
          )}
          {ins.clientAlerts.length > 0 && (
            <Card title="Client compliance">
              <ul className="space-y-1 text-sm">
                {ins.clientAlerts.map((a) => (
                  <li key={a.code} className="flex items-start justify-between gap-2">
                    <span>{a.text}</span>
                    <Badge tone={a.severity === "BLOCKER" ? "red" : "amber"}>{a.severity === "BLOCKER" ? "Blocker" : "Warning"}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {f.isBroker && (
            <Card title="Estimated duty">
              {ins.dutyEstimate ? (
                <>
                  <p className="text-2xl font-semibold tabular-nums">{formatMoney(ins.dutyEstimate.minor, e.currency ?? "USD")}</p>
                  <p className="mb-2 text-xs text-slate-500">
                    From {ins.dutyEstimate.lines} of {ins.dutyEstimate.of} lines with a broker-entered rate.
                  </p>
                </>
              ) : (
                <p className="mb-2 text-sm text-slate-500">Enter a duty rate on a line to see an estimate.</p>
              )}
              <DutyNote />
            </Card>
          )}
          {f.isBroker && perms.has("finance.manage") && (
            <Card title="Brokerage billing">
              <p className="mb-2 text-sm text-slate-600">
                {ins.client && (ins.client.entryFeeMinor || ins.client.perLineFeeMinor || ins.client.isfFeeMinor)
                  ? `Fee schedule: entry ${ins.client.entryFeeMinor != null ? formatMoney(ins.client.entryFeeMinor, "USD") : "—"}, per line ${ins.client.perLineFeeMinor != null ? formatMoney(ins.client.perLineFeeMinor, "USD") : "—"}, ISF ${ins.client.isfFeeMinor != null ? formatMoney(ins.client.isfFeeMinor, "USD") : "—"}.`
                  : "No fee schedule on the client record."}
              </p>
              <ActionButton path={`/customs/${e.id}/charges`} variant="secondary">
                Create estimated brokerage charges
              </ActionButton>
              <p className="mt-2 text-xs text-slate-500">Charges are created as estimates. The importer approves them before they can be invoiced.</p>
            </Card>
          )}
          <Card title="Entry summary">
            <KV
              items={[
                ["Entry type", e.entryType ? (ENTRY_TYPES.find((t) => t.code === e.entryType)?.label ?? e.entryType) : "Not set"],
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
