import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, DemoBadge, Empty, NotConnected, PageHeader, StatusBadge, Table, Td, type Tone } from "@/components/ui";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { aiEngine } from "@/server/adapters/ai";
import { load } from "@/server/page";
import { brokerDashboard } from "@/server/services/brokerage";
import { customsWorkspace } from "@/server/services/customs";
import { OpenEntry } from "../shipments/[id]/forms";
import { TaskDone } from "./[id]/forms";
import { scoreTone, STATE_LABEL, STATE_TONE } from "./shared";

export const metadata: Metadata = { title: "Brokerage desk" };

const LANES: { key: string; label: string; statuses: string[] }[] = [
  { key: "docs", label: "Collecting documents", statuses: ["INTAKE", "DOCS_PENDING"] },
  { key: "review", label: "Broker review", statuses: ["IN_REVIEW"] },
  { key: "ready", label: "Ready to file", statuses: ["READY_TO_FILE"] },
  { key: "filed", label: "Filed, awaiting release", statuses: ["SUBMITTED"] },
  { key: "hold", label: "On hold", statuses: ["HOLD"] },
  { key: "released", label: "Released", statuses: ["RELEASED"] },
];

export default async function BrokerageDesk() {
  const { d, ws, tz, canManage } = await load(
    async (ctx) => ({ d: await brokerDashboard(ctx), ws: await customsWorkspace(ctx), tz: ctx.org.timezone, canManage: ctx.perms.has("customs.manage") }),
    { need: "customs.read" },
  );
  const engine = aiEngine();
  const intake = ws.intake.filter((i) => !i.entry);
  const staff = new Map(ws.staff.map((s) => [s.id, s.name]));
  const kpis: { label: string; value: number; tone: Tone; hint: string }[] = [
    { label: "Active entries", value: d.kpis.active, tone: "slate", hint: "Not yet released or closed" },
    { label: "Deadlines due < 48h", value: d.kpis.dueSoon, tone: d.kpis.dueSoon ? "amber" : "slate", hint: "From your brokerage's deadline rules" },
    { label: "Overdue deadlines", value: d.kpis.overdue, tone: d.kpis.overdue ? "red" : "slate", hint: "Open deadlines past due" },
    { label: "Open review blockers", value: d.kpis.blockers, tone: d.kpis.blockers ? "red" : "slate", hint: "Unresolved blocking findings from the latest pre-filing reviews" },
    { label: "Ready to file", value: d.kpis.ready, tone: d.kpis.ready ? "green" : "slate", hint: "Cleared by a licensed broker" },
    { label: "Client compliance blockers", value: d.kpis.clientIssues, tone: d.kpis.clientIssues ? "red" : "slate", hint: "Missing or expired POA, expired bond" },
  ];

  return (
    <>
      <PageHeader
        title="Brokerage desk"
        subtitle="Every entry, deadline and client in one place. AI prepares and checks the work; licensed brokers make every customs decision."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet" title="Which AI engine is active">
              AI: {engine === "anthropic" ? "Claude" : "demonstration rules engine"}
            </Badge>
            <NotConnected what="CBP ACE" />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-3" title={k.hint}>
            <p className="text-xs font-medium text-slate-500">{k.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${k.tone === "red" ? "text-red-700" : k.tone === "amber" ? "text-amber-700" : k.tone === "green" ? "text-emerald-700" : "text-slate-900"}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <section className="mt-6" aria-labelledby="pipeline">
        <h2 id="pipeline" className="mb-2 text-sm font-semibold text-slate-800">
          Entry pipeline
        </h2>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {LANES.map((lane) => {
            const rows = d.rows.filter((r) => lane.statuses.includes(r.entry.status));
            return (
              <div key={lane.key} className="rounded-lg bg-slate-50 p-2" data-lane={lane.key}>
                <p className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-slate-600">
                  {lane.label} <span className="tabular-nums text-slate-400">{rows.length}</span>
                </p>
                <ul className="space-y-2">
                  {rows.map((r) => (
                    <li key={r.entry.id}>
                      <Link href={`/customs/${r.entry.id}`} className="block rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm hover:border-brand-300">
                        <p className="font-medium text-brand-700">{r.reference}</p>
                        <p className="truncate text-xs text-slate-600">{r.client?.name ?? r.entry.importerName ?? "No client linked"}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.review ? (
                            <Badge tone={scoreTone(r.review.score)} title="Readiness score from the latest pre-filing review">
                              {r.review.score}/100{r.review.blockers ? ` · ${r.review.blockers} blocker${r.review.blockers > 1 ? "s" : ""}` : ""}
                            </Badge>
                          ) : (
                            <Badge>Not reviewed</Badge>
                          )}
                          {r.lines > 0 && (
                            <Badge tone={r.linesReviewed === r.lines ? "green" : "slate"}>
                              {r.linesReviewed}/{r.lines} lines
                            </Badge>
                          )}
                        </div>
                        {r.nextDeadline && (
                          <p className="mt-1 text-xs">
                            <Badge tone={STATE_TONE[r.nextDeadline.state]}>{r.nextDeadline.label.replace(/\s*\(.*\)$/, "")}</Badge> <span className="text-slate-500">{relativeTime(r.nextDeadline.dueAt)}</span>
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-400">{r.assignee ?? "Unassigned"}</p>
                      </Link>
                    </li>
                  ))}
                  {rows.length === 0 && <li className="px-1 text-xs text-slate-400">None</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <Card title="Deadlines" actions={<Link href="/customs/rules" className="text-xs text-brand-600 hover:underline">Deadline rules</Link>} pad={false}>
            {d.deadlines.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No open deadlines. Deadlines appear once an entry has its key dates.</div>
            ) : (
              <Table head={["Due", "Deadline", "Entry", "Reference", ""]}>
                {d.deadlines.map((x) => (
                  <tr key={x.id}>
                    <Td className="text-xs">
                      <Badge tone={STATE_TONE[x.state]}>{STATE_LABEL[x.state]}</Badge>
                      <p className="mt-1 text-slate-500">{formatInTimeZone(x.dueAt, tz)}</p>
                    </Td>
                    <Td className="whitespace-normal">{x.label}</Td>
                    <Td>
                      <Link href={`/customs/${x.entryId}`} className="text-brand-700 hover:underline">
                        {x.entry.reference}
                      </Link>
                    </Td>
                    <Td className="max-w-xs whitespace-normal text-xs text-slate-500">{x.reference}</Td>
                    <Td>{canManage && <ActionButton path={`/customs/deadlines/${x.id}`} method="PATCH" body={{ status: "MET" }} variant="ghost">Mark met</ActionButton>}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Due dates are computed from your brokerage&apos;s rules and the dates recorded on each entry. They are a planning aid; confirm statutory deadlines against current CBP guidance.
            </p>
          </Card>

          <Card title={`New intake (${intake.length})`} pad={false}>
            {intake.length === 0 ? (
              <div className="p-4">
                <Empty title="No new shipments waiting for a customs file" />
              </div>
            ) : (
              <Table head={["Shipment", "Importer", "Port / ETA", ""]}>
                {intake.map(({ shipment: s, importer }) => (
                  <tr key={s.id}>
                    <Td>
                      <Link href={`/shipments/${s.id}`} className="font-medium text-brand-700 hover:underline">
                        {s.reference}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {s.containerNumber ?? "No container"} {s.isDemo && <DemoBadge label="Demo" />}
                      </p>
                    </Td>
                    <Td>{importer}</Td>
                    <Td className="text-xs">
                      {s.portOfEntry ?? "—"}
                      <p className="text-slate-500">{s.portEta ? formatInTimeZone(s.portEta, tz, { dateOnly: true }) : ""}</p>
                    </Td>
                    <Td>{canManage && <OpenEntry shipmentId={s.id} portOfEntry={s.portOfEntry} importerName={importer} />}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="All files" pad={false}>
            {ws.intake.filter((i) => i.entry).length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No customs files yet.</div>
            ) : (
              <Table head={["Shipment", "Importer", "Documents", "Status", ""]}>
                {ws.intake
                  .filter((i) => i.entry)
                  .map(({ shipment: s, importer, entry, requirements }) => {
                    const outstanding = requirements.filter((r) => r.status === "REQUESTED").length;
                    return (
                      <tr key={s.id}>
                        <Td>
                          <span className="font-medium">{s.reference}</span> {s.isDemo && <DemoBadge label="Demo" />}
                        </Td>
                        <Td>{importer}</Td>
                        <Td>{outstanding ? <Badge tone="amber">{outstanding} outstanding</Badge> : requirements.length ? <Badge tone="green">Complete</Badge> : "—"}</Td>
                        <Td>
                          <StatusBadge status={entry!.status} />
                        </Td>
                        <Td>
                          <Link href={`/customs/${entry!.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                            Open file →
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Client compliance" actions={<Link href="/customs/clients" className="text-xs text-brand-600 hover:underline">All clients</Link>}>
            {d.clientIssues.length === 0 ? (
              <p className="text-sm text-slate-500">No client issues.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.clientIssues.map((x, i) => (
                  <li key={i} className="flex items-start justify-between gap-2">
                    <span>
                      <Link href={`/customs/clients/${x.client.id}`} className="font-medium text-brand-700 hover:underline">
                        {x.client.name}
                      </Link>
                      <span className="block text-xs text-slate-600">{x.alert.text}</span>
                    </span>
                    <Badge tone={x.alert.severity === "BLOCKER" ? "red" : "amber"}>{x.alert.severity === "BLOCKER" ? "Blocker" : "Warning"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Team workload" pad={false}>
            <Table head={["Person", "Entries", "Tasks"]}>
              {d.workload.map((w) => (
                <tr key={w.id}>
                  <Td>
                    {w.name}
                    <p className="text-xs text-slate-500">{w.roles.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}</p>
                  </Td>
                  <Td className="tabular-nums">{w.entries}</Td>
                  <Td className="tabular-nums">
                    {w.tasks}
                    {w.overdueTasks > 0 && (
                      <>
                        {" "}
                        <Badge tone="red">{w.overdueTasks} overdue</Badge>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title={`Open tasks (${ws.tasks.length})`}>
            {ws.tasks.length === 0 ? (
              <p className="text-sm text-slate-500">No open tasks.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {ws.tasks.map((t) => (
                  <li key={t.id} className="py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{t.title}</p>
                        <p className="text-xs text-slate-500">
                          {t.assigneeUserId ? staff.get(t.assigneeUserId) : "Unassigned"} · due {t.dueAt ? relativeTime(t.dueAt) : "—"} {t.priority === "HIGH" && <Badge tone="red">High</Badge>}
                        </p>
                      </div>
                      <TaskDone id={t.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
