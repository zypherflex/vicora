import type { Metadata } from "next";
import { Badge, Card, DemoBadge, NotConnected, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { EQUIPMENT_LABEL, ORG_TYPE_LABEL, SERVICE_TYPE_LABEL, type EquipmentType, type ServiceType } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { listComplianceFor, providerDirectory } from "@/server/services/compliance";
import { ComplianceRecordForm, VerifyRecord } from "./forms";

export const metadata: Metadata = { title: "Providers & compliance" };

const TYPE_LABEL: Record<string, string> = {
  OPERATING_AUTHORITY: "Authority",
  USDOT_REGISTRATION: "USDOT",
  AUTO_LIABILITY_INSURANCE: "Auto liability",
  CARGO_INSURANCE: "Cargo insurance",
  CUSTOMS_LICENSE: "Customs license",
  W9: "W-9",
};

function RecordStatus({ r }: { r: { status: string; source: string; expiresAt: Date | null } }) {
  const expired = r.expiresAt && r.expiresAt < new Date();
  if (expired) return <Badge tone="red">Expired</Badge>;
  if (r.status === "VERIFIED") return <Badge tone="green">{r.source === "DEMO_ADAPTER" ? "Verified (demo adapter)" : "Verified (document review)"}</Badge>;
  if (r.status === "REJECTED") return <Badge tone="red">Rejected</Badge>;
  return <Badge tone="amber">{r.status === "PENDING_REVIEW" ? "Awaiting review" : "Self-reported, not verified"}</Badge>;
}

export default async function ProvidersPage() {
  const d = await load(
    async (ctx) => ({
      dir: await providerDirectory(ctx),
      mine: await listComplianceFor(ctx, ctx.org.id),
      orgId: ctx.org.id,
      tz: ctx.org.timezone,
      canVerify: ctx.perms.has("compliance.verify"),
      canManage: ctx.perms.has("compliance.manage"),
      isProvider: ["CARRIER", "AUTO_TRANSPORT", "FREIGHT_BROKER", "CUSTOMS_BROKER"].includes(ctx.org.type),
    }),
    { need: "compliance.read" },
  );
  return (
    <>
      <PageHeader title="Providers & compliance" subtitle="Authority, insurance and performance records, with where each verification came from." />
      <div className="mb-4 flex flex-wrap gap-2">
        <NotConnected what="FMCSA registry lookup" />
        <NotConnected what="Insurance carrier verification" />
      </div>
      <div className="space-y-6">
        <Card title="Provider directory" pad={false}>
          <Table head={["Provider", "Services", "Records", "History", ""]}>
            {d.dir
              .filter((o) => o.id !== d.orgId)
              .map((o) => (
                <tr key={o.id}>
                  <Td>
                    <p className="font-medium">
                      {o.name} {o.isDemo && <DemoBadge label="Demo" />}
                    </p>
                    <p className="text-xs text-slate-500">
                      {ORG_TYPE_LABEL[o.type]} · {o.city}, {o.state}
                      {o.usdot && ` · USDOT ${o.usdot}`}
                      {o.mc && ` · ${o.mc}`}
                    </p>
                  </Td>
                  <Td className="whitespace-normal text-xs">
                    {o.profile ? (
                      <>
                        <p>{o.profile.serviceTypes.map((s) => SERVICE_TYPE_LABEL[s as ServiceType] ?? s).join(", ")}</p>
                        <p className="text-slate-500">{o.profile.equipmentTypes.map((e) => EQUIPMENT_LABEL[e as EquipmentType] ?? e).join(", ")}</p>
                        <p className="text-slate-500">{o.profile.serviceStates.length} states {o.profile.acceptingLoads ? "" : "· not accepting loads"}</p>
                      </>
                    ) : (
                      "No profile"
                    )}
                  </Td>
                  <Td className="whitespace-normal">
                    <ul className="space-y-1 text-xs">
                      {o.records.length === 0 && <li className="text-slate-500">No records</li>}
                      {o.records.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-1">
                          <span className="font-medium">{TYPE_LABEL[r.type] ?? r.type}</span>
                          <RecordStatus r={r} />
                          {r.expiresAt && <span className="text-slate-500">exp {formatInTimeZone(r.expiresAt, d.tz, { dateOnly: true })}</span>}
                          {r.coverageMinor != null && <span className="text-slate-500">{formatMoney(r.coverageMinor, "USD")}</span>}
                          {d.canVerify && r.status !== "VERIFIED" && !(r.expiresAt && r.expiresAt < new Date()) && <VerifyRecord id={r.id} hasDocument={!!r.documentId} isDemoSubject={o.isDemo} />}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td className="text-xs">
                    {o.profile?.onTimePct != null && (o.profile.completedLoads ?? 0) >= 5 ? `${o.profile.onTimePct}% on time / ${o.profile.completedLoads} loads` : "Insufficient history"}
                    <p className="text-slate-500">{o.sharedLoads} loads on Vicora</p>
                  </Td>
                  <Td />
                </tr>
              ))}
          </Table>
        </Card>
        {d.isProvider && (
          <Card title="Your compliance records">
            <ul className="mb-4 space-y-1 text-sm">
              {d.mine.length === 0 && <li className="text-slate-500">No records yet. Brokers and shippers see what you add here, labeled as self-reported until verified.</li>}
              {d.mine.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{TYPE_LABEL[r.type] ?? r.type}</span> {r.identifier} <RecordStatus r={r} />
                  {r.expiresAt && <span className="text-xs text-slate-500">expires {formatInTimeZone(r.expiresAt, d.tz, { dateOnly: true })}</span>}
                </li>
              ))}
            </ul>
            {d.canManage && <ComplianceRecordForm />}
          </Card>
        )}
      </div>
    </>
  );
}
