import type { Metadata } from "next";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { listAudit } from "@/server/services/comms";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const { rows, tz } = await load(async (ctx) => ({ rows: await listAudit(ctx, { limit: 300 }), tz: ctx.org.timezone }), { need: "audit.read" });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Consequential actions taken in your organization, with before and after values. Append-only." />
      <Card pad={false}>
        <Table head={["When", "Who", "Action", "Entity", "Change"]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="text-xs">{formatInTimeZone(r.createdAt, tz)}</Td>
              <Td>{r.actorName}</Td>
              <Td className="font-mono text-xs">{r.action}</Td>
              <Td className="text-xs">
                {r.entityType} <span className="text-slate-400">{r.entityId?.slice(0, 8)}</span>
              </Td>
              <Td className="max-w-md whitespace-normal">
                {(r.before != null || r.after != null) ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500">details</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                  </details>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
