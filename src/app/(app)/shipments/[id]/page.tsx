import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { LazyShipmentMap } from "@/components/map/lazy";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, DemoBadge, Empty, KV, Notice, NotConnected, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { ACCESSORIAL_LABEL, EQUIPMENT_LABEL, LEG_STATUS_LABEL, SERVICE_TYPE_LABEL, SHIPMENT_STATUS_LABEL, categoryLabel, type Accessorial, type EquipmentType, type LegStatus } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatInTimeZone, relativeTime } from "@/lib/time";
import { can, type Ctx } from "@/server/authz/context";
import { inspectionDamages, organizations } from "@/server/db/schema";
import { load } from "@/server/page";
import { matchProviders } from "@/server/services/compliance";
import { listFleet, compareConditionReports } from "@/server/services/fleet";
import { getShipmentTwin, type ShipmentTwin } from "@/server/services/shipments";
import {
  AppointBroker,
  ChargeForm,
  CopilotPanel,
  DispatchForm,
  DocRequestForm,
  DownloadButton,
  ExceptionActions,
  ExceptionForm,
  InvoiceCreate,
  LocationReporter,
  MessageForm,
  MilestoneForm,
  OpenEntry,
  QuoteForm,
  StatusControl,
  TenderForm,
  TenderResponse,
  TrackingLinkForm,
  UploadForm,
} from "./forms";

export const metadata: Metadata = { title: "Shipment" };

const TABS = ["overview", "timeline", "quotes", "dispatch", "vehicles", "documents", "messages", "exceptions", "finance", "customs", "tracking", "copilot"] as const;
type Tab = (typeof TABS)[number];

async function loadExtras(ctx: Ctx, twin: ShipmentTwin, tab: Tab) {
  const a = twin.access;
  const out: {
    matches?: Awaited<ReturnType<typeof matchProviders>>;
    fleet?: Awaited<ReturnType<typeof listFleet>>;
    brokers?: { id: string; name: string }[];
    damages?: (typeof inspectionDamages.$inferSelect)[];
    newDamage?: Record<string, { area: string; damageType: string; severity: string }[]>;
  } = {};
  if (tab === "dispatch" && !a.previewOnly) {
    if (a.isProvider && can(ctx, "tender.create")) out.matches = await matchProviders(ctx, twin.shipment.id, "tender");
    if ((a.isExecutor || a.isProvider) && can(ctx, "fleet.read")) out.fleet = await listFleet(ctx);
  }
  if (tab === "customs" && a.isCustomer && twin.shipment.requiresCustoms) {
    out.brokers = await ctx.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.type, "CUSTOMS_BROKER"), eq(organizations.status, "ACTIVE")));
  }
  if (tab === "vehicles" && twin.inspections.length) {
    out.damages = await ctx.db.select().from(inspectionDamages).where(inArray(inspectionDamages.inspectionId, twin.inspections.map((i) => i.id)));
    out.newDamage = {};
    for (const v of twin.vehicles) out.newDamage[v.id] = await compareConditionReports(ctx, v.id);
  }
  return out;
}

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const { twin, extras, me } = await load(async (ctx) => {
    const twin = await getShipmentTwin(ctx, id);
    const extras = await loadExtras(ctx, twin, tab);
    return { twin, extras, me: { orgId: ctx.org.id, orgType: ctx.org.type, tz: ctx.org.timezone, perms: ctx.perms } };
  });
  const s = twin.shipment;
  const a = twin.access;
  const p = (x: string) => me.perms.has(x as never);
  const origin = twin.stops[0];
  const dest = twin.stops.at(-1);
  const orgName = (oid: string | null | undefined) => (oid ? twin.orgs[oid]?.name ?? "—" : "—");
  const base = `/shipments/${s.id}`;

  if (a.previewOnly) return <Preview twin={twin} me={me} />;

  const openEx = twin.exceptions.filter((e) => e.status !== "RESOLVED").length;
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "timeline", label: "Timeline", count: twin.events.length },
    { key: "quotes", label: "Quotes", count: twin.quotes.length },
    { key: "dispatch", label: "Dispatch" },
    ...(twin.vehicles.length ? [{ key: "vehicles", label: "Vehicles", count: twin.vehicles.length }] : []),
    { key: "documents", label: "Documents", count: twin.documents.length },
    { key: "messages", label: "Messages", count: twin.messages.length },
    { key: "exceptions", label: "Exceptions", count: openEx },
    ...(p("finance.read") ? [{ key: "finance", label: "Finance" }] : []),
    ...(s.requiresCustoms ? [{ key: "customs", label: "Customs" }] : []),
    { key: "tracking", label: "Tracking links" },
    ...(p("ai.use") ? [{ key: "copilot", label: "Copilot" }] : []),
  ];

  const statusOptions: { to: string; label: string; danger?: boolean }[] = [];
  if (a.isCustomer && s.status === "QUOTE_REQUESTED" && p("shipment.update")) statusOptions.push({ to: "DRAFT", label: "Withdraw quote request" });
  if ((a.isCustomer || a.isProvider) && ["DRAFT", "QUOTE_REQUESTED", "BOOKED", "ASSIGNED"].includes(s.status) && p("shipment.cancel") && (a.isCustomer || s.status !== "DRAFT"))
    statusOptions.push({ to: "CANCELLED", label: "Cancel shipment", danger: true });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{s.reference}</h1>
            <StatusBadge status={s.status} label={SHIPMENT_STATUS_LABEL[s.status]} />
            {s.isDemo && <DemoBadge />}
            {s.requiresCustoms && <Badge tone="blue">Import</Badge>}
            {openEx > 0 && <Badge tone="red">{openEx} open exception{openEx > 1 ? "s" : ""}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">{s.title}</p>
          <p className="text-xs text-slate-500">
            {origin?.city}, {origin?.state} → {dest?.city}, {dest?.state} · {SERVICE_TYPE_LABEL[s.serviceType]} · Your role: {a.roles.map((r) => r.toLowerCase().replace("_", " ")).join(", ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {a.isCustomer && s.status === "DRAFT" && p("quote.request") && (
            <ActionButton path={`/shipments/${s.id}/request-quotes`} variant="primary" size="md">
              Request quotes
            </ActionButton>
          )}
          {a.isProvider && s.status === "DELIVERED" && p("finance.manage") && (
            <ActionButton path={`/shipments/${s.id}/complete`} variant="primary" size="md" confirm="Complete this shipment? Payables are created for carriers once delivery is confirmed.">
              Mark complete
            </ActionButton>
          )}
          <StatusControl shipmentId={s.id} options={statusOptions} />
        </div>
      </div>
      <Tabs base={base} current={tab} tabs={tabs} />

      {tab === "overview" && <Overview twin={twin} me={me} orgName={orgName} />}
      {tab === "timeline" && <Timeline twin={twin} tz={me.tz} />}
      {tab === "quotes" && <Quotes twin={twin} me={me} orgName={orgName} />}
      {tab === "dispatch" && <Dispatch twin={twin} me={me} extras={extras} orgName={orgName} />}
      {tab === "vehicles" && <Vehicles twin={twin} me={me} extras={extras} />}
      {tab === "documents" && <Documents twin={twin} me={me} />}
      {tab === "messages" && <Messages twin={twin} me={me} orgName={orgName} />}
      {tab === "exceptions" && <Exceptions twin={twin} me={me} />}
      {tab === "finance" && <Finance twin={twin} me={me} orgName={orgName} />}
      {tab === "customs" && <Customs twin={twin} me={me} extras={extras} orgName={orgName} />}
      {tab === "tracking" && <Tracking twin={twin} me={me} />}
      {tab === "copilot" && (
        <Card title="Operations copilot">
          <Notice>
            The copilot reads only what you can already see on this shipment. It drafts and suggests; it never sends messages, changes records, or makes customs determinations.
          </Notice>
          <div className="mt-4">
            <CopilotPanel shipmentId={s.id} canMessage={p("message.write")} />
          </div>
        </Card>
      )}
    </>
  );
}

type Me = { orgId: string; orgType: string; tz: string; perms: Set<string> };
type OrgName = (id: string | null | undefined) => string;
type Extras = Awaited<ReturnType<typeof loadExtras>>;

function Overview({ twin, me, orgName }: { twin: ShipmentTwin; me: Me; orgName: OrgName }) {
  const s = twin.shipment;
  const last = twin.pings[0];
  const mapRow = {
    id: s.id,
    reference: s.reference,
    title: s.title,
    status: s.status,
    origin: twin.stops[0] ? { lat: twin.stops[0].lat, lng: twin.stops[0].lng, city: twin.stops[0].city, state: twin.stops[0].state } : null,
    destination: twin.stops.at(-1) ? { lat: twin.stops.at(-1)!.lat, lng: twin.stops.at(-1)!.lng, city: twin.stops.at(-1)!.city, state: twin.stops.at(-1)!.state } : null,
    last: last ? { lat: last.lat, lng: last.lng, source: last.source, at: last.recordedAt.toISOString() } : null,
    attention: twin.exceptions.some((e) => e.status !== "RESOLVED"),
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <LazyShipmentMap shipments={[mapRow]} height={300} linkBase={null} />
        {last && (
          <p className="text-xs text-slate-500">
            Last location {relativeTime(last.recordedAt)} · {last.label ?? `${last.lat.toFixed(3)}, ${last.lng.toFixed(3)}`} ·{" "}
            {last.source === "DEMO" ? <Badge tone="violet">Demo simulator</Badge> : last.source === "MANUAL" ? "manually reported" : "device GPS"}
          </p>
        )}
        <Card title="Stops">
          <ol className="space-y-3">
            {twin.stops.map((st, i) => (
              <li key={st.id} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{i + 1}</span>
                <div className="text-sm">
                  <p className="font-medium">
                    {st.name} <span className="text-xs font-normal uppercase text-slate-500">{st.kind.replace("_", " ")}</span>
                  </p>
                  <p className="text-slate-600">
                    {[st.address1, `${st.city}, ${st.state} ${st.postalCode ?? ""}`].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs text-slate-500">
                    Window: {formatInTimeZone(st.windowStart, st.timezone)} – {formatInTimeZone(st.windowEnd, st.timezone)}
                    {st.reference && ` · Ref ${st.reference}`}
                  </p>
                  {(st.contactName || st.contactPhone) && <p className="text-xs text-slate-500">Contact: {[st.contactName, st.contactPhone].filter(Boolean).join(", ")}</p>}
                  {st.notes && <p className="text-xs text-slate-500">{st.notes}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
        {twin.items.length > 0 && (
          <Card title="Cargo" pad={false}>
            <Table head={["Description", "Qty", "Weight", "Dims (in)", "Class", "Flags"]}>
              {twin.items.map((it) => (
                <tr key={it.id}>
                  <Td>{it.description}</Td>
                  <Td>
                    {it.quantity} {it.packaging.toLowerCase()}
                  </Td>
                  <Td>{it.weightLb.toLocaleString()} lb</Td>
                  <Td>{[it.lengthIn, it.widthIn, it.heightIn].map((x) => x ?? "?").join("×")}</Td>
                  <Td>{it.freightClass ?? "—"}</Td>
                  <Td>
                    {!it.stackable && <Badge>Do not stack</Badge>} {it.hazmat && <Badge tone="red">Hazmat</Badge>}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <Card title="Shipment">
          <KV
            items={[
              ["Customer", orgName(s.ownerOrgId)],
              ["Provider", orgName(s.primaryProviderOrgId)],
              ["Customer ref", s.customerReference],
              ["Equipment", s.equipmentType ? EQUIPMENT_LABEL[s.equipmentType as EquipmentType] : null],
              ["Commodity", s.commodity],
              ["Weight", s.totalWeightLb ? `${s.totalWeightLb.toLocaleString()} lb` : null],
              ["Temperature", s.temperatureMinF != null ? `${s.temperatureMinF}–${s.temperatureMaxF} °F` : null],
              ["Budget", s.targetBudgetMinor != null && twin.access.isCustomer ? formatMoney(s.targetBudgetMinor, s.currency) : null],
            ]}
          />
          {s.accessorials.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {s.accessorials.map((x) => (
                <Badge key={x}>{ACCESSORIAL_LABEL[x as Accessorial] ?? x}</Badge>
              ))}
            </div>
          )}
          {s.specialInstructions && <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900">{s.specialInstructions}</p>}
        </Card>
        <Card title="Legs">
          {twin.legs.length === 0 ? (
            <p className="text-sm text-slate-500">Legs are created when a quote is accepted.</p>
          ) : (
            <ul className="space-y-3">
              {twin.legs.map((l) => (
                <li key={l.id} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Leg {l.seq + 1}</span>
                    <StatusBadge status={l.status} label={LEG_STATUS_LABEL[l.status]} />
                  </div>
                  <p className="text-xs text-slate-500">
                    Carrier: {orgName(l.executorOrgId)}
                    {l.driver && ` · Driver ${l.driver.name}`}
                    {l.equipment && ` · Unit ${l.equipment.unitNumber}`}
                  </p>
                  {l.etaAt && <p className="text-xs text-slate-500">ETA {formatInTimeZone(l.etaAt, twin.stops.at(-1)?.timezone ?? me.tz)} (estimated from last location)</p>}
                  {l.carrierRateMinor != null && <p className="text-xs text-slate-500">Carrier rate {formatMoney(l.carrierRateMinor, l.currency)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {twin.finance && (
          <Card title="Margin (visible to your org only)">
            <KV
              items={[
                ["Revenue (confirmed)", formatMoney(twin.finance.revenueMinor, s.currency)],
                ["Cost", formatMoney(twin.finance.costMinor, s.currency)],
                ["Margin", formatMoney(twin.finance.marginMinor, s.currency)],
              ]}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function Timeline({ twin, tz }: { twin: ShipmentTwin; tz: string }) {
  if (!twin.events.length) return <Empty title="No events yet" />;
  return (
    <Card>
      <ol className="relative space-y-4 border-l border-slate-200 pl-5">
        {twin.events.map((e) => (
          <li key={e.id}>
            <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${e.visibleToOrgId ? "bg-slate-400" : e.type.includes("EXCEPTION") ? "bg-red-500" : "bg-brand-600"}`} />
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-slate-800">{e.title}</p>
              {e.visibleToOrgId && <Badge>Internal</Badge>}
              {e.customerTracking && <Badge tone="blue">On tracking page</Badge>}
            </div>
            <p className="text-xs text-slate-500">
              {formatInTimeZone(e.occurredAt, tz)} · {e.actorUserId ? twin.users[e.actorUserId] ?? "User" : "System"}
              {e.actorOrgId && twin.orgs[e.actorOrgId] ? ` (${twin.orgs[e.actorOrgId].name})` : ""}
              {+e.recordedAt - +e.occurredAt > 10 * 60_000 && ` · recorded ${formatInTimeZone(e.recordedAt, tz)}`}
            </p>
            {typeof e.detail.preview === "string" && <p className="mt-1 text-sm text-slate-600">“{e.detail.preview}”</p>}
            {typeof e.detail.note === "string" && e.detail.note && <p className="mt-1 text-sm text-slate-600">{e.detail.note}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Quotes({ twin, me, orgName }: { twin: ShipmentTwin; me: Me; orgName: OrgName }) {
  const s = twin.shipment;
  const a = twin.access;
  const p = (x: string) => me.perms.has(x);
  if (!twin.quotes.length) return <Empty title={s.status === "DRAFT" ? "Request quotes to start receiving offers" : "No quotes yet"}>Providers matching this lane see your request on their load board.</Empty>;
  const cheapest = Math.min(...twin.quotes.filter((q) => q.status === "SUBMITTED").map((q) => q.totalMinor));
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {twin.quotes.map((q) => (
        <Card
          key={q.id}
          title={
            <span className="flex items-center gap-2">
              {orgName(q.providerOrgId)} <StatusBadge status={q.status} />
            </span>
          }
        >
          <p className="text-2xl font-semibold">{formatMoney(q.totalMinor, q.currency)}</p>
          <p className="text-xs text-slate-500">
            {q.transitDays != null ? `${q.transitDays}-day transit` : "Transit not stated"} · valid until {formatInTimeZone(q.validUntil, me.tz, { dateOnly: true })}
            {q.status === "SUBMITTED" && q.totalMinor === cheapest && twin.quotes.length > 1 && (
              <>
                {" "}
                · <span className="font-medium text-emerald-700">Lowest price</span>
              </>
            )}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {q.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span className="text-slate-600">{l.description}</span>
                <span>{formatMoney(l.amountMinor, q.currency)}</span>
              </li>
            ))}
          </ul>
          {q.notes && <p className="mt-2 text-xs text-slate-500">{q.notes}</p>}
          {q.estimatedCostMinor != null && <p className="mt-2 text-xs text-slate-500">Your private cost estimate: {formatMoney(q.estimatedCostMinor, q.currency)}</p>}
          <div className="mt-4 flex gap-2">
            {a.isCustomer && q.status === "SUBMITTED" && s.status === "QUOTE_REQUESTED" && p("quote.accept") && (
              <ActionButton path={`/quotes/${q.id}/accept`} variant="primary" confirm={`Accept ${orgName(q.providerOrgId)} at ${formatMoney(q.totalMinor, q.currency)}? Other quotes will be declined and the shipment is booked.`}>
                Accept quote
              </ActionButton>
            )}
            {q.providerOrgId === me.orgId && q.status === "SUBMITTED" && (
              <ActionButton path={`/quotes/${q.id}/withdraw`} confirm="Withdraw this quote?">
                Withdraw
              </ActionButton>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Dispatch({ twin, me, extras, orgName }: { twin: ShipmentTwin; me: Me; extras: Extras; orgName: OrgName }) {
  const s = twin.shipment;
  const a = twin.access;
  const p = (x: string) => me.perms.has(x);
  if (!twin.legs.length) return <Empty title="Nothing to dispatch yet">Legs are created when the customer accepts a quote.</Empty>;
  const accepted = twin.quotes.find((q) => q.status === "ACCEPTED");
  const openLegs = twin.legs.filter((l) => l.status === "PLANNED" || l.status === "TENDERED");
  return (
    <div className="space-y-4">
      {twin.legs.map((l) => {
        const managing = l.managerOrgId === me.orgId;
        const executing = l.executorOrgId === me.orgId;
        const tenders = twin.tenders.filter((t) => t.legId === l.id);
        const incoming = tenders.find((t) => t.toOrgId === me.orgId && t.status === "OFFERED");
        return (
          <Card key={l.id} title={<span className="flex items-center gap-2">Leg {l.seq + 1} <StatusBadge status={l.status} label={LEG_STATUS_LABEL[l.status]} /></span>}>
            <KV
              items={[
                ["Managed by", orgName(l.managerOrgId)],
                ["Carrier", orgName(l.executorOrgId)],
                ["Driver", l.driver ? `${l.driver.name}${l.driver.phone ? ` · ${l.driver.phone}` : ""}` : null],
                ["Equipment", l.equipment ? `${l.equipment.unitNumber} · ${EQUIPMENT_LABEL[l.equipment.type as EquipmentType] ?? l.equipment.type}` : null],
                ["Picked up", l.actualPickupAt ? formatInTimeZone(l.actualPickupAt, twin.stops[0]?.timezone ?? me.tz) : null],
                ["Delivered", l.actualDeliveryAt ? formatInTimeZone(l.actualDeliveryAt, twin.stops.at(-1)?.timezone ?? me.tz) : null],
              ]}
            />
            {tenders.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Tenders</p>
                <ul className="space-y-1 text-sm">
                  {tenders.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={t.status} /> {orgName(t.toOrgId)}
                      {(managing || t.toOrgId === me.orgId) && <span className="text-slate-500">{formatMoney(t.rateMinor, t.currency)}</span>}
                      {t.expiresAt && t.status === "OFFERED" && <span className="text-xs text-slate-500">expires {relativeTime(t.expiresAt)}</span>}
                      {t.notes && <span className="text-xs text-slate-500">“{t.notes}”</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {incoming && p("tender.respond") && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="mb-2 text-sm font-medium">You have been offered this leg at {formatMoney(incoming.rateMinor, incoming.currency)}.</p>
                <TenderResponse tenderId={incoming.id} />
              </div>
            )}
            {executing && l.status === "ACCEPTED" && p("dispatch.manage") && extras.fleet && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">Assign driver and equipment</p>
                <DispatchForm
                  shipmentId={s.id}
                  legId={l.id}
                  drivers={extras.fleet.drivers.filter((d) => d.status !== "INACTIVE").map((d) => ({ id: d.id, name: d.name }))}
                  equipment={extras.fleet.equipment.map((e) => ({ id: e.id, label: `${e.unitNumber} · ${EQUIPMENT_LABEL[e.type as EquipmentType] ?? e.type} · ${e.status.toLowerCase()}`, disabled: e.status === "MAINTENANCE" }))}
                />
              </div>
            )}
            {(executing || managing) && p("milestone.record") && ["DISPATCHED", "AT_PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_DELIVERY"].includes(l.status) && (
              <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium">Record milestone</p>
                  <MilestoneForm shipmentId={s.id} legId={l.id} status={l.status as LegStatus} compact />
                </div>
                {executing && p("location.report") && (
                  <div>
                    <p className="mb-2 text-sm font-medium">Location</p>
                    <LocationReporter shipmentId={s.id} legId={l.id} />
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {a.isProvider && p("tender.create") && openLegs.length > 0 && extras.matches && (
        <Card title="Tender to a carrier">
          <div className="mb-4 overflow-x-auto">
            <Table head={["Carrier", "Score", "Why", "Authority", "Insurance"]}>
              {extras.matches.slice(0, 8).map((m) => (
                <tr key={m.orgId} className={m.eligible ? "" : "opacity-60"}>
                  <Td>
                    <p className="font-medium">{m.name}</p>
                    {!m.eligible && <p className="text-xs text-red-600">{m.ineligibleReasons.join("; ")}</p>}
                  </Td>
                  <Td>{m.score}/100</Td>
                  <Td className="whitespace-normal text-xs text-slate-600">
                    <ul>
                      {m.criteria.map((c) => (
                        <li key={c.key}>
                          {c.label}: {Math.round(c.points)}/{c.max} · {c.detail}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td>
                    <StatusBadge status={m.verification.authority === "Verified" ? "VERIFIED" : m.verification.authority === "Expired" ? "EXPIRED" : "UNVERIFIED"} label={m.verification.authority} />
                  </Td>
                  <Td>
                    <StatusBadge status={m.verification.insurance === "Verified" ? "VERIFIED" : m.verification.insurance === "Expired" ? "EXPIRED" : "UNVERIFIED"} label={m.verification.insurance} />
                    {m.verification.source && <p className="text-[11px] text-slate-400">via {m.verification.source.replaceAll("_", " ").toLowerCase()}</p>}
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Scores come from published rules: service area, equipment availability, verified records and on-time history. Self-reported records earn no verification points.
          </p>
          <TenderForm
            shipmentId={s.id}
            legs={openLegs.map((l) => ({ id: l.id, label: `Leg ${l.seq + 1}` }))}
            carriers={extras.matches.map((m) => ({ orgId: m.orgId, name: m.name, eligible: m.eligible, score: m.score }))}
            customerTotalMinor={accepted?.totalMinor ?? null}
          />
        </Card>
      )}
    </div>
  );
}

function Vehicles({ twin, me, extras }: { twin: ShipmentTwin; me: Me; extras: Extras }) {
  const canInspect = me.perms.has("inspection.perform") && twin.access.isExecutor;
  return (
    <div className="space-y-4">
      {canInspect && (
        <Notice>
          Drivers record pickup and delivery condition reports with photos from the <Link className="underline" href={`/driver/${twin.shipment.id}`}>driver app</Link>.
        </Notice>
      )}
      {twin.vehicles.map((v) => {
        const reps = twin.inspections.filter((i) => i.vehicleId === v.id);
        const fresh = extras.newDamage?.[v.id] ?? [];
        return (
          <Card key={v.id} title={<span className="flex items-center gap-2">{v.year} {v.make} {v.model} <StatusBadge status={v.status === "DAMAGE_REPORTED" ? "HIGH" : v.status} label={v.status.replace("_", " ").toLowerCase()} /></span>}>
            <KV
              items={[
                ["VIN", <code key="vin">{v.vin}</code>],
                ["Color", v.color],
                ["Condition", v.operable ? "Runs and drives" : "Inoperable"],
                ["Transport", v.transportType.toLowerCase()],
                ["Auction ref", v.auctionReference],
                ["Dealer stock #", v.dealershipReference],
              ]}
            />
            {fresh.length > 0 && (
              <Notice tone="red">
                New at delivery (not on pickup report): {fresh.map((d) => `${d.area} ${d.damageType.toLowerCase()} (${d.severity.toLowerCase()})`).join(", ")}
              </Notice>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(["PICKUP", "DELIVERY"] as const).map((k) => {
                const r = reps.filter((x) => x.kind === k).at(-1);
                const dmg = r ? (extras.damages ?? []).filter((d) => d.inspectionId === r.id) : [];
                return (
                  <div key={k} className="rounded-md border border-slate-200 p-3 text-sm">
                    <p className="font-medium">{k === "PICKUP" ? "Pickup" : "Delivery"} condition report</p>
                    {!r ? (
                      <p className="text-xs text-slate-500">Not recorded yet.</p>
                    ) : (
                      <>
                        <p className="text-xs text-slate-500">
                          {formatInTimeZone(r.performedAt, me.tz)} · odometer {r.odometer?.toLocaleString() ?? "—"} · signed by {r.signerName ?? "—"}
                        </p>
                        {dmg.length === 0 ? (
                          <p className="mt-1 text-xs text-emerald-700">No damage noted.</p>
                        ) : (
                          <ul className="mt-1 list-disc pl-4 text-xs">
                            {dmg.map((d) => (
                              <li key={d.id}>
                                {d.area}: {d.damageType.toLowerCase()} ({d.severity.toLowerCase()}){d.note ? ` · ${d.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.notes && <p className="mt-1 text-xs text-slate-600">{r.notes}</p>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Documents({ twin, me }: { twin: ShipmentTwin; me: Me }) {
  const s = twin.shipment;
  const canUpload = me.perms.has("document.upload");
  const canInternal = me.perms.has("internal_note.write");
  return (
    <div className="space-y-4">
      {twin.requirements.length > 0 && (
        <Card title="Requested documents">
          <ul className="divide-y divide-slate-100 text-sm">
            {twin.requirements.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {categoryLabel(r.category)} {r.note && <span className="text-xs text-slate-500">· {r.note}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {r.dueAt && `due ${formatInTimeZone(r.dueAt, me.tz, { dateOnly: true })}`} <StatusBadge status={r.status === "REQUESTED" ? "PENDING" : r.status} label={r.status.toLowerCase()} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canUpload && (
        <Card title="Upload">
          <UploadForm shipmentId={s.id} canInternal={canInternal} />
          <p className="mt-2 text-xs text-slate-500">PDF, image, text or CSV. Files are scanned by type, stored privately and opened through short-lived signed links.</p>
        </Card>
      )}
      <Card title="Documents" pad={false}>
        {twin.documents.length === 0 ? (
          <div className="p-4">
            <Empty title="No documents yet" />
          </div>
        ) : (
          <Table head={["Document", "Category", "Uploaded", "Status", "Visibility", ""]}>
            {twin.documents.map((d) => (
              <tr key={d.id}>
                <Td>
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-slate-500">
                    {d.version?.filename} · v{d.currentVersion} · {d.version ? `${Math.ceil(d.version.sizeBytes / 1024)} KB` : ""}
                  </p>
                </Td>
                <Td>{categoryLabel(d.category)}</Td>
                <Td className="text-xs">
                  {formatInTimeZone(d.createdAt, me.tz)}
                  <p className="text-slate-500">{twin.orgs[d.ownerOrgId]?.name ?? (d.ownerOrgId === me.orgId ? "Your org" : "")}</p>
                </Td>
                <Td>
                  <StatusBadge status={d.status === "UPLOADED" ? "PENDING" : d.status} label={d.status.replace("_", " ").toLowerCase()} />
                </Td>
                <Td>{d.visibility === "INTERNAL" ? <Badge>Internal</Badge> : <Badge tone="blue">Shared</Badge>}</Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-3">
                    {d.version && !d.version.purgedAt ? <DownloadButton versionId={d.version.id} /> : <span className="text-xs text-slate-400">Purged by retention</span>}
                    {me.perms.has("document.review") && d.ownerOrgId !== me.orgId && d.status !== "APPROVED" && (
                      <ActionButton path={`/documents/${d.id}/review`} body={{ status: "APPROVED" }} variant="ghost">
                        Approve
                      </ActionButton>
                    )}
                    {me.perms.has("customs.manage") && twin.access.isCustomsBroker && ["COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "ARRIVAL_NOTICE"].includes(d.category) && (
                      <ActionButton path={`/documents/${d.id}/extractions`} variant="ghost">
                        Extract fields
                      </ActionButton>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {me.perms.has("document.review") && !twin.access.isCustomer && (
        <Card title="Request a document from the parties">
          <DocRequestForm shipmentId={s.id} />
        </Card>
      )}
    </div>
  );
}

function Messages({ twin, me, orgName }: { twin: ShipmentTwin; me: Me; orgName: OrgName }) {
  return (
    <Card title="Shipment conversation">
      <ul className="mb-4 space-y-3">
        {twin.messages.length === 0 && <li className="text-sm text-slate-500">No messages yet. Messages here are visible to every organization on this shipment.</li>}
        {twin.messages.map((m) => (
          <li key={m.id} className={`rounded-lg p-3 text-sm ${m.visibility === "INTERNAL" ? "border border-dashed border-slate-300 bg-slate-50" : m.orgId === me.orgId ? "bg-brand-50" : "bg-white ring-1 ring-slate-200"}`}>
            <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <strong className="text-slate-700">{m.authorUserId ? twin.users[m.authorUserId] ?? "User" : "System"}</strong> {orgName(m.orgId)} · {formatInTimeZone(m.createdAt, me.tz)}
              {m.visibility === "INTERNAL" && <Badge>Internal note</Badge>}
              {m.aiDrafted && <Badge tone="violet">AI-assisted</Badge>}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {me.perms.has("message.write") && <MessageForm shipmentId={twin.shipment.id} canInternal={me.perms.has("internal_note.write")} />}
    </Card>
  );
}

function Exceptions({ twin, me }: { twin: ShipmentTwin; me: Me }) {
  return (
    <div className="space-y-4">
      {twin.exceptions.length === 0 && <Empty title="No exceptions" />}
      {twin.exceptions.map((e) => (
        <Card key={e.id}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.severity} />
            <StatusBadge status={e.status} />
            <span className="text-xs uppercase text-slate-500">{e.type.replaceAll("_", " ")}</span>
            {e.detectedBy !== "USER" && <Badge tone="violet">Detected by rule</Badge>}
            {e.customerVisible ? <Badge tone="blue">Customer can see</Badge> : <Badge>Not shown to customer</Badge>}
          </div>
          <p className="mt-2 font-medium">{e.title}</p>
          {e.description && <p className="text-sm text-slate-600">{e.description}</p>}
          {Object.keys(e.evidence).length > 0 && (
            <details className="mt-1 text-xs text-slate-500">
              <summary className="cursor-pointer">Evidence</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(e.evidence, null, 2)}</pre>
            </details>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Opened {formatInTimeZone(e.createdAt, me.tz)}
            {e.resolvedAt && ` · resolved ${formatInTimeZone(e.resolvedAt, me.tz)}`}
          </p>
          {e.resolution && <p className="mt-1 text-sm text-emerald-800">Resolution: {e.resolution}</p>}
          {me.perms.has("exception.manage") && <ExceptionActions exceptionId={e.id} status={e.status} />}
        </Card>
      ))}
      {me.perms.has("exception.manage") && (
        <Card title="Report an exception">
          <ExceptionForm shipmentId={twin.shipment.id} isCustomer={twin.access.isCustomer} />
        </Card>
      )}
    </div>
  );
}

function Finance({ twin, me, orgName }: { twin: ShipmentTwin; me: Me; orgName: OrgName }) {
  const s = twin.shipment;
  const canManage = me.perms.has("finance.manage");
  const uninvoiced = twin.charges.filter((c) => c.billerOrgId === me.orgId && c.kind === "RECEIVABLE" && c.status === "CONFIRMED" && !c.invoiceId);
  return (
    <div className="space-y-4">
      <Card title="Charges" pad={false}>
        {twin.charges.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No charges visible to your organization.</div>
        ) : (
          <Table head={["Charge", "From → to", "Amount", "Status", ""]}>
            {twin.charges.map((c) => (
              <tr key={c.id}>
                <Td>
                  <p>{c.description}</p>
                  <p className="text-xs text-slate-500">
                    {c.code} · {c.kind === "PAYABLE" ? "carrier payable" : "customer receivable"} · from {c.source.toLowerCase()}
                  </p>
                </Td>
                <Td className="text-xs">
                  {orgName(c.billerOrgId)} → {orgName(c.billToOrgId)}
                </Td>
                <Td>{formatMoney(c.amountMinor, c.currency)}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                  {c.invoiceId && <span className="ml-1 text-xs text-slate-500">invoiced</span>}
                </Td>
                <Td>
                  {c.status === "ESTIMATED" && c.billToOrgId === me.orgId && canManage && (
                    <span className="flex gap-2">
                      <ActionButton path={`/charges/${c.id}/decision`} body={{ approve: true }} variant="primary">
                        Approve
                      </ActionButton>
                      <ActionButton path={`/charges/${c.id}/decision`} body={{ approve: false }}>
                        Dispute
                      </ActionButton>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {twin.invoices.length > 0 && (
        <Card title="Invoices">
          <ul className="divide-y divide-slate-100 text-sm">
            {twin.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <Link href={`/finance/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline">
                  {i.number}
                </Link>
                <span className="flex items-center gap-2">
                  {formatMoney(i.totalMinor, i.currency)} <StatusBadge status={i.status} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canManage && !["CANCELLED"].includes(s.status) && twin.legs.length > 0 && (
        <Card title="Add a charge">
          <ChargeForm shipmentId={s.id} />
          <p className="mt-2 text-xs text-slate-500">You bill the party above you on this shipment. Amounts are stored as integer cents.</p>
        </Card>
      )}
      {canManage && me.perms.has("invoice.create") && uninvoiced.length > 0 && (
        <Card title="Ready to invoice">
          <p className="mb-2 text-sm text-slate-600">
            {uninvoiced.length} confirmed charge{uninvoiced.length > 1 ? "s" : ""} totaling {formatMoney(uninvoiced.reduce((a, c) => a + c.amountMinor, 0), s.currency)}
          </p>
          <InvoiceCreate shipmentId={s.id} />
        </Card>
      )}
    </div>
  );
}

function Customs({ twin, me, extras, orgName }: { twin: ShipmentTwin; me: Me; extras: Extras; orgName: OrgName }) {
  const s = twin.shipment;
  const a = twin.access;
  const entry = twin.customs[0];
  const broker = twin.parties.find((x) => x.role === "CUSTOMS_BROKER");
  return (
    <div className="space-y-4">
      <Card title="Import details">
        <KV
          items={[
            ["Port of entry", s.portOfEntry],
            ["Vessel / voyage", s.vesselVoyage],
            ["Container", s.containerNumber],
            ["Bill of lading", s.billOfLadingNumber],
            ["Country of origin", s.countryOfOrigin],
            ["Port ETA", s.portEta ? formatInTimeZone(s.portEta, me.tz, { dateOnly: true }) : null],
            ["Customs broker", broker ? orgName(broker.orgId) : "Not appointed"],
          ]}
        />
      </Card>
      {!broker && a.isCustomer && extras.brokers && (
        <Card title="Appoint a customs broker">
          <AppointBroker shipmentId={s.id} brokers={extras.brokers} />
        </Card>
      )}
      {a.isCustomsBroker && !entry && me.perms.has("customs.manage") && (
        <Card title="Start the customs file">
          <OpenEntry shipmentId={s.id} portOfEntry={s.portOfEntry} importerName={orgName(s.ownerOrgId)} />
        </Card>
      )}
      {entry && (
        <Card title="Customs file">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={entry.status} />
            {entry.filingAdapter === "NOT_CONNECTED" || entry.filingAdapter === "ACE_ABI" ? <NotConnected what="CBP ACE filing" /> : <Badge tone="violet">Demo filing adapter</Badge>}
            {entry.filingReference && <span className="text-xs text-slate-500">Ref {entry.filingReference}</span>}
          </div>
          {a.isCustomsBroker ? (
            <Link href={`/customs/${entry.id}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
              Open customs workspace →
            </Link>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Your broker manages this file. Upload requested documents on the Documents tab.</p>
          )}
        </Card>
      )}
    </div>
  );
}

function Tracking({ twin, me }: { twin: ShipmentTwin; me: Me }) {
  const can = me.perms.has("tracking_link.manage");
  return (
    <div className="space-y-4">
      <Notice>
        Tracking links show status, milestones and approximate location only. They never show pricing, documents, contacts, internal notes or the driver&apos;s identity.
      </Notice>
      {can && (
        <Card title="New customer tracking link">
          <TrackingLinkForm shipmentId={twin.shipment.id} />
        </Card>
      )}
      <Card title="Links" pad={false}>
        {twin.trackingLinks.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No tracking links.</div>
        ) : (
          <Table head={["Label", "Token", "Expires", "Last opened", ""]}>
            {twin.trackingLinks.map((l) => {
              const active = !l.revokedAt && l.expiresAt > new Date();
              return (
                <tr key={l.id}>
                  <Td>{l.label ?? "—"}</Td>
                  <Td>
                    <code>{l.tokenPrefix}…</code>
                  </Td>
                  <Td>{l.revokedAt ? <Badge tone="red">Revoked</Badge> : formatInTimeZone(l.expiresAt, me.tz, { dateOnly: true })}</Td>
                  <Td>{l.lastAccessedAt ? relativeTime(l.lastAccessedAt) : "Never"}</Td>
                  <Td>
                    {active && can && l.createdByOrgId === me.orgId && (
                      <ActionButton path={`/tracking-links/${l.id}`} method="DELETE" confirm="Revoke this link? Anyone holding it loses access immediately.">
                        Revoke
                      </ActionButton>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

/** Limited view for providers browsing an open request or reviewing a tender offer. */
function Preview({ twin, me }: { twin: ShipmentTwin; me: Pick<Me, "orgId" | "perms" | "tz"> }) {
  const s = twin.shipment;
  const myQuote = twin.quotes.find((q) => q.providerOrgId === me.orgId && q.status === "SUBMITTED");
  const tender = twin.tenders.find((t) => t.toOrgId === me.orgId && t.status === "OFFERED");
  return (
    <>
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{s.reference}</h1>
          <StatusBadge status={s.status} label={SHIPMENT_STATUS_LABEL[s.status]} />
          {s.isDemo && <DemoBadge />}
          <Badge>Limited preview</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-600">{s.title}</p>
      </div>
      <Notice>You see lane, timing and cargo only. Contacts, documents and the full timeline open up if you are awarded the shipment.</Notice>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Lane">
          <ol className="space-y-2 text-sm">
            {twin.stops.map((st) => (
              <li key={st.id}>
                <span className="font-medium">
                  {st.city}, {st.state}
                </span>{" "}
                <span className="text-xs uppercase text-slate-500">{st.kind.toLowerCase()}</span>
                <p className="text-xs text-slate-500">
                  {formatInTimeZone(st.windowStart, st.timezone)} – {formatInTimeZone(st.windowEnd, st.timezone)}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-3">
            <KV
              items={[
                ["Service", SERVICE_TYPE_LABEL[s.serviceType]],
                ["Equipment", s.equipmentType ? EQUIPMENT_LABEL[s.equipmentType as EquipmentType] : "Any"],
                ["Weight", s.totalWeightLb ? `${s.totalWeightLb.toLocaleString()} lb` : null],
                ["Vehicles", twin.vehicles.length ? `${twin.vehicles.length} (${twin.vehicles.filter((v) => !v.operable).length} inoperable)` : null],
                ["Target budget", s.targetBudgetMinor != null ? formatMoney(s.targetBudgetMinor, s.currency) : "Not shared"],
              ]}
            />
          </div>
        </Card>
        {tender && me.perms.has("tender.respond") ? (
          <Card title={`Tender offer: ${formatMoney(tender.rateMinor, tender.currency)}`}>
            {tender.notes && <p className="mb-2 text-sm text-slate-600">“{tender.notes}”</p>}
            {tender.expiresAt && <p className="mb-3 text-xs text-slate-500">Expires {relativeTime(tender.expiresAt)}</p>}
            <TenderResponse tenderId={tender.id} />
          </Card>
        ) : s.status === "QUOTE_REQUESTED" && me.perms.has("quote.submit") ? (
          <Card title={myQuote ? "Your quote" : "Submit a quote"}>
            {myQuote ? (
              <>
                <p className="text-2xl font-semibold">{formatMoney(myQuote.totalMinor, myQuote.currency)}</p>
                <p className="mb-3 text-xs text-slate-500">Submitted {relativeTime(myQuote.createdAt)}. You can withdraw and resubmit.</p>
                <ActionButton path={`/quotes/${myQuote.id}/withdraw`} confirm="Withdraw this quote?">
                  Withdraw quote
                </ActionButton>
              </>
            ) : (
              <QuoteForm shipmentId={s.id} defaultCode={s.serviceType === "AUTO_TRANSPORT" ? "LINEHAUL" : "LINEHAUL"} />
            )}
          </Card>
        ) : (
          <Card title="Not open for quotes">
            <p className="text-sm text-slate-500">This request is no longer accepting quotes.</p>
          </Card>
        )}
      </div>
    </>
  );
}
