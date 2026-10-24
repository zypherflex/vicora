import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, DemoBadge, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { ORG_TYPE_LABEL, type OrgType } from "@/lib/domain";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { requireAuth } from "@/server/page";
import { platformOverview } from "@/server/services/platform";

export const metadata: Metadata = { title: "Platform admin" };

export default async function AdminPage() {
  const auth = await requireAuth();
  if (!auth.user.isPlatformAdmin) notFound();
  const o = await platformOverview(auth);
  return (
    <>
      <PageHeader title="Platform admin" subtitle="Cross-tenant operations. Every action here is audited." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {o.jobStats.map((j) => (
          <Badge key={j.status} tone={j.status === "FAILED" ? "red" : "slate"}>
            jobs {j.status.toLowerCase()}: {j.n}
          </Badge>
        ))}
      </div>
      <div className="space-y-6">
        <Card title="Organizations" pad={false}>
          <Table head={["Organization", "Type", "Members", "Shipments", "Created", "Status", ""]}>
            {o.orgs.map((x) => (
              <tr key={x.id}>
                <Td>
                  {x.name} {x.is_demo && <DemoBadge label="Demo" />}
                </Td>
                <Td>{ORG_TYPE_LABEL[x.type as OrgType]}</Td>
                <Td>{x.members}</Td>
                <Td>{x.shipments}</Td>
                <Td>{relativeTime(x.created_at)}</Td>
                <Td>
                  <StatusBadge status={x.status === "ACTIVE" ? "CONFIRMED" : "REJECTED"} label={x.status.toLowerCase()} />
                </Td>
                <Td>
                  <ActionButton path={`/admin/orgs/${x.id}`} method="PATCH" body={{ status: x.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }} confirm={`${x.status === "ACTIVE" ? "Suspend" : "Reactivate"} ${x.name}?`}>
                    {x.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                  </ActionButton>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {o.failedJobs.length > 0 && (
          <Card title="Failed jobs" pad={false}>
            <Table head={["Type", "Attempts", "Error", "Created"]}>
              {o.failedJobs.map((j) => (
                <tr key={j.id}>
                  <Td className="font-mono text-xs">{j.type}</Td>
                  <Td>{j.attempts}</Td>
                  <Td className="max-w-md whitespace-normal text-xs text-red-700">{j.lastError}</Td>
                  <Td>{relativeTime(j.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
        <Card title="Outbound message outbox (email/SMS not connected)" pad={false}>
          <Table head={["To", "Subject", "Status", "When"]}>
            {o.outbox.map((m) => (
              <tr key={m.id}>
                <Td>{m.to}</Td>
                <Td className="max-w-sm truncate">{m.subject}</Td>
                <Td>
                  <Badge tone="amber">{m.status.replaceAll("_", " ").toLowerCase()}</Badge>
                </Td>
                <Td>{relativeTime(m.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Payment webhooks received" pad={false}>
          <Table head={["Provider", "Event", "Type", "Received"]}>
            {o.webhooks.map((w) => (
              <tr key={w.id}>
                <Td>{w.provider}</Td>
                <Td className="font-mono text-xs">{w.eventId}</Td>
                <Td>{w.type}</Td>
                <Td>{formatInTimeZone(w.receivedAt, "UTC")}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
