import { LEG_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/domain";
import { formatInTimeZone } from "@/lib/time";
import { generateCopilot, type CopilotSource } from "@/server/adapters/ai";
import { requirePerm, type Ctx } from "@/server/authz/context";
import { attentionFor } from "./attention";
import { getShipmentTwin } from "./shipments";

/**
 * Operations copilot. Works only from the shipment twin as the caller is allowed to see it
 * (row-level security plus field redaction), so the AI can never reveal more than the user could.
 * Output is advisory: drafts must be reviewed and sent by a person.
 */
export async function runCopilot(ctx: Ctx, shipmentId: string, task: "summarize" | "draft_update" | "next_steps", audience: "customer" | "internal") {
  requirePerm(ctx, "ai.use");
  const twin = await getShipmentTwin(ctx, shipmentId);
  if (twin.access.previewOnly) requirePerm(ctx, "shipment.read");
  const s = twin.shipment;
  const tz = ctx.org.timezone;
  // Customer-audience drafts only use customer-safe facts even when the caller can see more.
  const customerSafe = audience === "customer";
  const events = twin.events.filter((e) => !customerSafe || e.customerTracking || ["STATUS_CHANGED", "MILESTONE", "EXCEPTION_OPENED"].includes(e.type)).slice(0, 25);
  const sources: CopilotSource[] = [
    ...events.map((e) => ({ id: e.id, kind: "event" as const, label: e.title, at: e.occurredAt.toISOString() })),
    ...twin.exceptions.filter((x) => x.status !== "RESOLVED" && (!customerSafe || x.customerVisible)).map((x) => ({ id: x.id, kind: "exception" as const, label: x.title })),
    ...twin.legs.map((l) => ({ id: l.id, kind: "leg" as const, label: `Leg ${l.seq + 1}: ${LEG_STATUS_LABEL[l.status]}` })),
    ...twin.requirements.filter((r) => r.status === "REQUESTED").map((r) => ({ id: r.id, kind: "document" as const, label: `Missing: ${r.category}` })),
  ];
  const origin = twin.stops[0];
  const dest = twin.stops.at(-1);
  const record = {
    reference: s.reference,
    status: SHIPMENT_STATUS_LABEL[s.status],
    service: s.serviceType,
    lane: `${origin?.city}, ${origin?.state} → ${dest?.city}, ${dest?.state}`,
    pickupWindow: origin ? `${formatInTimeZone(origin.windowStart, origin.timezone)} – ${formatInTimeZone(origin.windowEnd, origin.timezone)}` : null,
    deliveryWindow: dest ? `${formatInTimeZone(dest.windowStart, dest.timezone)} – ${formatInTimeZone(dest.windowEnd, dest.timezone)}` : null,
    legs: twin.legs.map((l) => ({ id: l.id, seq: l.seq + 1, status: l.status, eta: l.etaAt ? formatInTimeZone(l.etaAt, dest?.timezone ?? tz) : null })),
    lastLocation: twin.pings[0] ? { label: twin.pings[0].label, at: formatInTimeZone(twin.pings[0].recordedAt, tz), source: twin.pings[0].source } : null,
    events: events.map((e) => ({ id: e.id, at: formatInTimeZone(e.occurredAt, tz), title: e.title })),
    openExceptions: sources.filter((x) => x.kind === "exception"),
    missingDocuments: sources.filter((x) => x.kind === "document"),
    vehicles: twin.vehicles.map((v) => `${v.year} ${v.make} ${v.model} (${v.status})`),
  };

  const fallback = () => demoCopilot(task, audience, record, sources);
  const out = await generateCopilot(task, audience, record, sources, fallback);
  return {
    ...out,
    sources: sources.filter((x) => out.sourceIds.includes(x.id)),
    disclaimer:
      out.engine === "demo-rules"
        ? "Demonstration engine (templated from shipment records, no language model). Review before use."
        : "AI-generated from shipment records you can access. Review before sending or acting.",
  };
}

export async function runAttentionCopilot(ctx: Ctx) {
  requirePerm(ctx, "ai.use");
  return attentionFor(ctx);
}

type Rec = {
  reference: string;
  status: string;
  lane: string;
  deliveryWindow: string | null;
  legs: { id: string; seq: number; status: string; eta: string | null }[];
  lastLocation: { label: string | null; at: string; source: string } | null;
  events: { id: string; at: string; title: string }[];
  openExceptions: CopilotSource[];
  missingDocuments: CopilotSource[];
};

function demoCopilot(task: string, audience: string, r: Rec, sources: CopilotSource[]) {
  const ids: string[] = [];
  const recent = r.events.slice(0, 3);
  ids.push(...recent.map((e) => e.id));
  if (task === "summarize") {
    const parts = [`${r.reference} (${r.lane}) is ${r.status.toLowerCase()}.`];
    if (recent.length) parts.push(`Latest: ${recent.map((e) => `${e.title} (${e.at})`).join("; ")}.`);
    if (r.lastLocation) parts.push(`Last location: ${r.lastLocation.label ?? "reported"} at ${r.lastLocation.at} [${r.lastLocation.source.toLowerCase()}].`);
    if (r.openExceptions.length) {
      parts.push(`${r.openExceptions.length} open exception(s): ${r.openExceptions.map((x) => x.label).join("; ")}.`);
      ids.push(...r.openExceptions.map((x) => x.id));
    }
    if (r.missingDocuments.length) {
      parts.push(`Missing documents: ${r.missingDocuments.map((x) => x.label.replace("Missing: ", "").toLowerCase().replace(/_/g, " ")).join(", ")}.`);
      ids.push(...r.missingDocuments.map((x) => x.id));
    }
    return { text: parts.join(" "), sourceIds: ids };
  }
  if (task === "draft_update") {
    const eta = r.legs.at(-1)?.eta;
    const lines = [
      `Hello,`,
      ``,
      `Here is an update on shipment ${r.reference} (${r.lane}). Current status: ${r.status.toLowerCase()}.`,
      recent[0] ? `Most recent milestone: ${recent[0].title} at ${recent[0].at}.` : ``,
      eta ? `Estimated arrival: ${eta} (estimate, subject to change).` : r.deliveryWindow ? `Scheduled delivery window: ${r.deliveryWindow}.` : ``,
      audience === "customer" && r.openExceptions.length ? `We are actively working on: ${r.openExceptions.map((x) => x.label).join("; ")}. We will follow up as soon as we have more information.` : ``,
      ``,
      `Thank you,`,
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
    return { text: lines.join("\n"), sourceIds: ids };
  }
  const steps: string[] = [];
  for (const x of r.openExceptions) {
    steps.push(`Resolve exception "${x.label}" and record the outcome.`);
    ids.push(x.id);
  }
  for (const d of r.missingDocuments) {
    steps.push(`Follow up on ${d.label.replace("Missing: ", "").toLowerCase().replace(/_/g, " ")}.`);
    ids.push(d.id);
  }
  const planned = r.legs.find((l) => ["PLANNED", "TENDERED"].includes(l.status));
  if (planned) {
    steps.push(`Secure a carrier for leg ${planned.seq} (currently ${planned.status.toLowerCase()}).`);
    ids.push(planned.id);
  }
  const accepted = r.legs.find((l) => l.status === "ACCEPTED");
  if (accepted) {
    steps.push(`Dispatch a driver and unit for leg ${accepted.seq}.`);
    ids.push(accepted.id);
  }
  if (!r.lastLocation && r.legs.some((l) => ["PICKED_UP", "IN_TRANSIT"].includes(l.status))) steps.push("Ask the driver to share location; no position has been reported since pickup.");
  if (!steps.length) steps.push("No blocking issues found in the record. Continue monitoring milestones.");
  return { text: steps.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join("\n"), sourceIds: ids.filter((id) => sources.some((s) => s.id === id)) };
}
