import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, DemoBadge, KV, Notice, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { maskIor } from "@/lib/customs";
import { formatMoney } from "@/lib/money";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { getClient } from "@/server/services/brokerage";
import { ClassificationDraftForm, ClientProfileForm, PoaForm } from "../forms";

export const metadata: Metadata = { title: "Client" };

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { d, tz, canManage, canApprove, isDemo } = await load(
    async (ctx) => ({ d: await getClient(ctx, clientId), tz: ctx.org.timezone, canManage: ctx.perms.has("customs.manage"), canApprove: ctx.perms.has("customs.approve"), isDemo: ctx.org.isDemo }),
    { need: "customs.read" },
  );
  const c = d.client;
  const fmt = (m: number | null) => (m != null ? formatMoney(m, c.currency) : "—");
  const day = (x: Date | null) => (x ? formatInTimeZone(x, tz, { dateOnly: true }) : "—");
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <>
            <Link href="/customs/clients" className="text-brand-600 hover:underline">
              Importer clients
            </Link>{" "}
            · IOR {maskIor(c.iorNumber)} · {c.status.toLowerCase()}
          </>
        }
        actions={isDemo ? <DemoBadge /> : undefined}
      />
      {d.alerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {d.alerts.map((a) => (
            <Notice key={a.code} tone={a.severity === "BLOCKER" ? "red" : "amber"}>
              <strong>{a.severity === "BLOCKER" ? "Blocker" : "Warning"}:</strong> {a.text}
            </Notice>
          ))}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <Card title={`Classification library (${d.library.filter((i) => i.status === "APPROVED").length} approved)`} pad={false}>
            <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
              Classifications this brokerage has approved for this client. Vicora uses them as precedent when the same or a similar product appears on a new entry. Each line still needs a licensed broker&apos;s review on every entry.
            </p>
            {d.library.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No classifications yet. Save reviewed lines from an entry, or draft one below.</p>
            ) : (
              <Table head={["Product", "HTS", "COO", "Status", "Used", ""]}>
                {d.library.map((i) => (
                  <tr key={i.id} className={i.status === "RETIRED" ? "opacity-60" : ""}>
                    <Td className="whitespace-normal">
                      {i.partNumber && <span className="font-mono text-xs text-slate-500">{i.partNumber} · </span>}
                      {i.description}
                      {i.rationale && <p className="text-xs text-slate-500">{i.rationale}</p>}
                    </Td>
                    <Td className="font-mono">{i.htsCode}</Td>
                    <Td>{i.countryOfOrigin ?? "—"}</Td>
                    <Td>
                      <StatusBadge status={i.status === "DRAFT" ? "PENDING" : i.status === "RETIRED" ? "VOID" : "APPROVED"} label={i.status.toLowerCase()} />
                      <p className="mt-1 text-xs text-slate-500">
                        {i.status === "APPROVED" && i.approvedBy ? `by ${d.users[i.approvedBy] ?? "broker"}` : i.source === "AI_SUGGESTION" ? "from AI suggestion" : ""}
                      </p>
                    </Td>
                    <Td className="tabular-nums">{i.timesUsed}</Td>
                    <Td>
                      {canApprove && i.status === "DRAFT" && (
                        <ActionButton path={`/customs/classifications/${i.id}/decision`} body={{ decision: "APPROVED" }} variant="secondary">
                          Approve
                        </ActionButton>
                      )}
                      {canApprove && i.status === "APPROVED" && (
                        <ActionButton path={`/customs/classifications/${i.id}/decision`} body={{ decision: "RETIRED" }} variant="ghost" confirm="Retire this classification? It will no longer be offered as precedent.">
                          Retire
                        </ActionButton>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            {canManage && (
              <div className="border-t border-slate-100 p-4">
                <p className="mb-2 text-sm font-medium">Draft a classification</p>
                <ClassificationDraftForm clientId={c.id} />
              </div>
            )}
          </Card>

          <Card title="Entries" pad={false}>
            {d.entries.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No entries for this client yet.</p>
            ) : (
              <Table head={["Shipment", "Entry number", "Arrival", "Status"]}>
                {d.entries.map((x) => (
                  <tr key={x.entry.id}>
                    <Td>
                      <Link href={`/customs/${x.entry.id}`} className="text-brand-700 hover:underline">
                        {x.reference}
                      </Link>
                      <p className="text-xs text-slate-500">{x.title}</p>
                    </Td>
                    <Td className="font-mono text-xs">{x.entry.entryNumber ?? "—"}</Td>
                    <Td className="text-xs">{day(x.entry.arrivalAt)}</Td>
                    <Td>
                      <StatusBadge status={x.entry.status} />
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {canManage && (
            <Card title="Client profile, bond and fees">
              <ClientProfileForm c={c} />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Power of attorney">
            <KV
              items={[
                ["Status", <StatusBadge key="s" status={c.poaStatus === "NONE" ? "REJECTED" : c.poaStatus === "RECEIVED" ? "PENDING" : c.poaStatus} label={c.poaStatus.toLowerCase()} />],
                ["Signed", day(c.poaSignedAt)],
                ["Expires", day(c.poaExpiresAt)],
                ["Verified", c.poaVerifiedAt ? `${day(c.poaVerifiedAt)} by ${c.poaVerifiedBy ? (d.users[c.poaVerifiedBy] ?? "broker") : "—"}` : "Not verified"],
              ]}
            />
            {canManage && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <PoaForm clientId={c.id} status={c.poaStatus} signedAt={c.poaSignedAt} expiresAt={c.poaExpiresAt} documents={d.poaDocuments} canApprove={canApprove} />
              </div>
            )}
          </Card>
          <Card title="Bond">
            <KV
              items={[
                ["Type", c.bondType === "NONE" ? "None recorded" : c.bondType.replace("_", " ").toLowerCase()],
                ["Number", c.bondNumber],
                ["Surety", c.suretyName],
                ["Amount", fmt(c.bondAmountMinor)],
                ["Expires", day(c.bondExpiresAt)],
                ["Source", <Badge key="b" tone={c.bondSource === "DOCUMENT_REVIEWED" ? "green" : "amber"}>{c.bondSource === "DOCUMENT_REVIEWED" ? "Document reviewed" : "Self-reported"}</Badge>],
              ]}
            />
            <p className="mt-2 text-xs text-slate-500">Bond status is recorded by your team. Vicora does not query CBP or the surety.</p>
          </Card>
          <Card title="Fee schedule">
            <KV
              items={[
                ["Entry preparation", fmt(c.entryFeeMinor)],
                ["Per line", fmt(c.perLineFeeMinor)],
                ["ISF (ocean)", fmt(c.isfFeeMinor)],
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
