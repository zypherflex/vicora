import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DemoBadge, Empty, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { maskIor } from "@/lib/customs";
import { load } from "@/server/page";
import { listClients } from "@/server/services/brokerage";
import { NewClientForm } from "./forms";

export const metadata: Metadata = { title: "Importer clients" };

export default async function ClientsPage() {
  const { clients, canManage, isDemo } = await load(async (ctx) => ({ clients: await listClients(ctx), canManage: ctx.perms.has("customs.manage"), isDemo: ctx.org.isDemo }), { need: "customs.read" });
  return (
    <>
      <PageHeader title="Importer clients" subtitle="Power of attorney, bond, fee schedule and each client's approved classification library." actions={isDemo ? <DemoBadge /> : undefined} />
      <Card pad={false}>
        {clients.length === 0 ? (
          <div className="p-4">
            <Empty title="No clients yet">Clients are created automatically when you open a customs file, or you can add one below.</Empty>
          </div>
        ) : (
          <Table head={["Client", "IOR", "POA", "Bond", "Library", "Open entries", "Alerts"]}>
            {clients.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link href={`/customs/clients/${c.id}`} className="font-medium text-brand-700 hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-slate-500">{c.status.toLowerCase()}</p>
                </Td>
                <Td className="font-mono text-xs">{maskIor(c.iorNumber)}</Td>
                <Td>
                  <StatusBadge status={c.poaStatus === "NONE" ? "REJECTED" : c.poaStatus === "RECEIVED" ? "PENDING" : c.poaStatus} label={c.poaStatus.toLowerCase()} />
                </Td>
                <Td className="text-xs">{c.bondType === "NONE" ? "None recorded" : c.bondType.replace("_", " ").toLowerCase()}</Td>
                <Td className="tabular-nums">{c.approvedItems} approved</Td>
                <Td className="tabular-nums">{c.openEntries}</Td>
                <Td>
                  {c.alerts.filter((a) => a.severity === "BLOCKER").length > 0 ? (
                    <Badge tone="red">{c.alerts.filter((a) => a.severity === "BLOCKER").length} blocker</Badge>
                  ) : c.alerts.length ? (
                    <Badge tone="amber">{c.alerts.length} warning{c.alerts.length > 1 ? "s" : ""}</Badge>
                  ) : (
                    <Badge tone="green">Clear</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {canManage && (
        <Card title="Add a client" className="mt-4">
          <NewClientForm />
        </Card>
      )}
    </>
  );
}
