import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DemoBadge, Empty, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { load } from "@/server/page";
import { customsWorkspace } from "@/server/services/customs";
import { OpenEntry } from "../shipments/[id]/forms";
import { TaskDone } from "./[id]/forms";

export const metadata: Metadata = { title: "Customs" };

export default async function CustomsPage() {
  const { ws, tz } = await load(async (ctx) => ({ ws: await customsWorkspace(ctx), tz: ctx.org.timezone }), { need: "customs.read" });
  const staff = new Map(ws.staff.map((s) => [s.id, s.name]));
  return (
    <>
      <PageHeader title="Customs workspace" subtitle="Intake, document collection, AI-assisted extraction with human review, and filing preparation." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card title="Files" pad={false}>
          {ws.intake.length === 0 ? (
            <div className="p-4">
              <Empty title="No shipments have appointed you yet" />
            </div>
          ) : (
            <Table head={["Shipment", "Importer", "Port / ETA", "Documents", "Status", ""]}>
              {ws.intake.map(({ shipment: s, importer, entry, requirements }) => {
                const outstanding = requirements.filter((r) => r.status === "REQUESTED").length;
                return (
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
                    <Td>{outstanding ? <Badge tone="amber">{outstanding} outstanding</Badge> : requirements.length ? <Badge tone="green">Complete</Badge> : "—"}</Td>
                    <Td>{entry ? <StatusBadge status={entry.status} /> : <Badge tone="amber">New intake</Badge>}</Td>
                    <Td>
                      {entry ? (
                        <Link href={`/customs/${entry.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                          Open file →
                        </Link>
                      ) : (
                        <OpenEntry shipmentId={s.id} portOfEntry={s.portOfEntry} importerName={importer} />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
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
    </>
  );
}
