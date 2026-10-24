/**
 * Fictional demonstration data. Every organization and user is flagged is_demo and named with a
 * ".demo" email domain. Workflows are driven through the real service layer (same permission checks
 * and RLS path as the web app), so seeded records look exactly like organically created ones.
 *
 *   npm run db:seed            (wipes all data first; development only)
 */
import "./load-env";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@/server/auth/crypto";
import { closeDb, systemDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { as } from "@/server/testing/actors";
import { solidPng, textPdf } from "@/server/testing/pdf";
import { createShipment, requestQuotes } from "@/server/services/shipments";
import { acceptQuote, submitQuote } from "@/server/services/quotes";
import { createTender, dispatchLeg, openException, recordLegMilestone, respondToTender } from "@/server/services/operations";
import { uploadDocument } from "@/server/services/documents";
import { createTrackingLink } from "@/server/services/tracking";
import { approvePayable, completeShipment, createInvoice, payInvoice, processPaymentWebhook } from "@/server/services/finance";
import { appointCustomsBroker, openCustomsEntry, requestExtraction, runExtraction, setCustomsStatus, upsertCustomsLine } from "@/server/services/customs";
import {
  askFile,
  createClassification,
  createClient,
  createLinesFromExtraction,
  decideClassification,
  runPreflightReview,
  setDeadlineStatus,
  setPowerOfAttorney,
  updateClient,
  updateEntryDetails,
} from "@/server/services/brokerage";
import { createTrip, recordInspection } from "@/server/services/fleet";
import { addComplianceRecord, verifyComplianceRecord } from "@/server/services/compliance";
import { postMessage } from "@/server/services/comms";
import { runDueJobs } from "@/server/jobs/worker";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database");
export const DEMO_PASSWORD = "VicoraDemo!2026";

const db = systemDb();
const now = Date.now();
const h = (hours: number) => new Date(now + hours * 3600_000);

async function wipe() {
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  await db.execute(sql.raw(`truncate ${tables.map((x) => `"${x.tablename}"`).join(", ")} restart identity cascade`));
  await db.execute(sql`alter sequence shipment_ref_seq restart with 1001`);
}

type OrgSeed = { key: string; name: string; type: (typeof t.orgTypeEnum.enumValues)[number]; city: string; state: string; tz: string; usdot?: string; mc?: string; filer?: string };
const ORGS: OrgSeed[] = [
  { key: "lakeshore", name: "Lakeshore Home Goods", type: "SHIPPER", city: "Chicago", state: "IL", tz: "America/Chicago" },
  { key: "pacific", name: "Pacific Crest Motors", type: "SHIPPER", city: "Nashville", state: "TN", tz: "America/Chicago" },
  { key: "harborline", name: "Harborline Customs Brokerage", type: "CUSTOMS_BROKER", city: "Long Beach", state: "CA", tz: "America/Los_Angeles", filer: "D9X" },
  { key: "meridian", name: "Meridian Freight Partners", type: "FREIGHT_BROKER", city: "Dallas", state: "TX", tz: "America/Chicago", usdot: "3810452", mc: "MC-1294410" },
  { key: "ironwood", name: "Ironwood Transport", type: "CARRIER", city: "Joliet", state: "IL", tz: "America/Chicago", usdot: "2947716", mc: "MC-998214" },
  { key: "desertsun", name: "Desert Sun Logistics", type: "CARRIER", city: "Phoenix", state: "AZ", tz: "America/Phoenix", usdot: "3302985", mc: "MC-1102357" },
  { key: "bluegrass", name: "Bluegrass Drayage", type: "CARRIER", city: "Savannah", state: "GA", tz: "America/New_York", usdot: "3577120", mc: "MC-1188034" },
  { key: "redline", name: "Redline Auto Carriers", type: "AUTO_TRANSPORT", city: "Atlanta", state: "GA", tz: "America/New_York", usdot: "3061877", mc: "MC-1040219" },
];

const USERS: { email: string; name: string; orgs: [string, string[]][]; admin?: boolean }[] = [
  { email: "admin@vicora.demo", name: "Avery Platform", orgs: [], admin: true },
  { email: "maya@lakeshore.demo", name: "Maya Okafor", orgs: [["lakeshore", ["OWNER"]]] },
  { email: "leo@lakeshore.demo", name: "Leo Brandt", orgs: [["lakeshore", ["SHIPPER_OPS"]]] },
  { email: "ap@lakeshore.demo", name: "Grace Liu", orgs: [["lakeshore", ["ACCOUNTING"]]] },
  { email: "kim@pacificcrest.demo", name: "Kim Alvarez", orgs: [["pacific", ["OWNER", "SHIPPER_OPS"]]] },
  { email: "ruth@harborline.demo", name: "Ruth Nakamura", orgs: [["harborline", ["OWNER", "CUSTOMS_BROKER_LICENSED"]]] },
  { email: "ben@harborline.demo", name: "Ben Osei", orgs: [["harborline", ["CUSTOMS_STAFF"]]] },
  { email: "dana@meridian.demo", name: "Dana Whitfield", orgs: [["meridian", ["OWNER", "FREIGHT_BROKER_AGENT"]]] },
  { email: "sam@meridian.demo", name: "Sam Reyes", orgs: [["meridian", ["ACCOUNTING"]]] },
  { email: "priya@meridian.demo", name: "Priya Raman", orgs: [["meridian", ["COMPLIANCE"]]] },
  { email: "ops@ironwood.demo", name: "Marcus Hale", orgs: [["ironwood", ["OWNER", "FLEET_MANAGER"]]] },
  { email: "carlos@ironwood.demo", name: "Carlos Mendez", orgs: [["ironwood", ["DRIVER"]]] },
  { email: "ops@desertsun.demo", name: "Rosa Delgado", orgs: [["desertsun", ["OWNER", "DISPATCHER"]]] },
  { email: "ops@bluegrass.demo", name: "Will Turner", orgs: [["bluegrass", ["OWNER", "DISPATCHER"]]] },
  { email: "jay@redline.demo", name: "Jay Patel", orgs: [["redline", ["OWNER", "DISPATCHER"]]] },
  { email: "tasha@redline.demo", name: "Tasha Greene", orgs: [["redline", ["DRIVER"]]] },
  // A consultant who belongs to two organizations, to demonstrate multi-org membership and switching.
  { email: "alex@consult.demo", name: "Alex Moreau", orgs: [["lakeshore", ["VIEWER"]], ["meridian", ["COMPLIANCE"]]] },
];

async function main() {
  console.log("Wiping database…");
  await wipe();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const org: Record<string, typeof t.organizations.$inferSelect> = {};
  for (const o of ORGS) {
    const [row] = await db
      .insert(t.organizations)
      .values({ name: o.name, slug: o.key, type: o.type, city: o.city, state: o.state, timezone: o.tz, usdotNumber: o.usdot, mcNumber: o.mc, customsFilerCode: o.filer, isDemo: true })
      .returning();
    org[o.key] = row;
  }
  for (const u of USERS) {
    const [row] = await db.insert(t.users).values({ email: u.email, name: u.name, passwordHash, isPlatformAdmin: !!u.admin, isDemo: true }).returning();
    for (const [key, roles] of u.orgs) await db.insert(t.memberships).values({ orgId: org[key].id, userId: row.id, roles });
  }

  // Provider profiles, fleets and drivers.
  const profiles: [string, string[], string[], string[], number, number][] = [
    ["meridian", ["FTL", "LTL", "INTERMODAL", "PORT_TO_DOOR", "AUTO_TRANSPORT"], ["DRY_VAN", "REEFER", "FLATBED", "CONTAINER_CHASSIS_40", "CAR_CARRIER_OPEN"], ["TX", "IL", "CA", "GA", "TN", "AZ", "OK", "MO", "AR", "AL", "MS"], 96, 412],
    ["ironwood", ["FTL", "LTL"], ["DRY_VAN", "REEFER"], ["IL", "IN", "WI", "MO", "TN", "TX", "OK", "AR", "GA", "AL"], 94, 1280],
    ["desertsun", ["FTL", "PORT_TO_DOOR"], ["DRY_VAN", "FLATBED", "CONTAINER_CHASSIS_40"], ["AZ", "CA", "NV", "NM", "TX", "UT"], 88, 640],
    ["bluegrass", ["PORT_TO_DOOR", "INTERMODAL"], ["CONTAINER_CHASSIS_20", "CONTAINER_CHASSIS_40"], ["GA", "SC", "NC", "FL", "TN"], 91, 233],
    ["redline", ["AUTO_TRANSPORT"], ["CAR_CARRIER_OPEN", "CAR_CARRIER_ENCLOSED"], ["GA", "TN", "AL", "FL", "SC", "NC", "KY", "CA", "AZ", "TX"], 97, 3110],
  ];
  for (const [key, st, eq_, states, otp, loads] of profiles) {
    await db.insert(t.providerProfiles).values({ orgId: org[key].id, serviceTypes: st, equipmentTypes: eq_, serviceStates: states, onTimePct: otp, completedLoads: loads, about: `${org[key].name} — fictional demonstration provider.` });
  }
  const units: [string, string, string, number | null, string, string, string][] = [
    ["ironwood", "IW-201", "DRY_VAN", null, "AVAILABLE", "Joliet", "IL"],
    ["ironwood", "IW-202", "DRY_VAN", null, "AVAILABLE", "Memphis", "TN"],
    ["ironwood", "IW-203", "DRY_VAN", null, "AVAILABLE", "Dallas", "TX"],
    ["ironwood", "IW-310", "REEFER", null, "MAINTENANCE", "Joliet", "IL"],
    ["desertsun", "DS-11", "DRY_VAN", null, "AVAILABLE", "Phoenix", "AZ"],
    ["desertsun", "DS-40", "CONTAINER_CHASSIS_40", null, "AVAILABLE", "Long Beach", "CA"],
    ["desertsun", "DS-71", "FLATBED", null, "IN_USE", "Tucson", "AZ"],
    ["bluegrass", "BG-C1", "CONTAINER_CHASSIS_40", null, "AVAILABLE", "Savannah", "GA"],
    ["bluegrass", "BG-C2", "CONTAINER_CHASSIS_20", null, "AVAILABLE", "Savannah", "GA"],
    ["redline", "RL-9A", "CAR_CARRIER_OPEN", 9, "AVAILABLE", "Atlanta", "GA"],
    ["redline", "RL-9B", "CAR_CARRIER_OPEN", 9, "AVAILABLE", "Los Angeles", "CA"],
    ["redline", "RL-E6", "CAR_CARRIER_ENCLOSED", 6, "AVAILABLE", "Atlanta", "GA"],
  ];
  const unit: Record<string, string> = {};
  for (const [key, num, type, cap, status, city, state] of units) {
    const [row] = await db.insert(t.equipment).values({ orgId: org[key].id, unitNumber: num, type, vehicleCapacity: cap, status: status as "AVAILABLE", currentCity: city, currentState: state }).returning();
    unit[num] = row.id;
  }
  const uid = async (email: string) => (await db.select().from(t.users).where(eq(t.users.email, email)))[0].id;
  const driver: Record<string, string> = {};
  for (const [key, name, email, phone, ls] of [
    ["ironwood", "Carlos Mendez", "carlos@ironwood.demo", "(815) 555-0142", "IL"],
    ["ironwood", "Denise Park", null, "(815) 555-0188", "IL"],
    ["desertsun", "Hector Ruiz", null, "(602) 555-0131", "AZ"],
    ["redline", "Tasha Greene", "tasha@redline.demo", "(404) 555-0119", "GA"],
  ] as const) {
    const [row] = await db
      .insert(t.drivers)
      .values({ orgId: org[key].id, name, phone, licenseState: ls, licenseExpiresAt: h(24 * 400), userId: email ? await uid(email) : null })
      .returning();
    driver[name] = row.id;
  }

  /* ------------------------------------------------------------ Compliance records */
  console.log("Compliance records…");
  const ironAuthDoc = await as("ops@ironwood.demo", (c) => uploadDocument(c, { orgLevel: true, filename: "ironwood-operating-authority.pdf", data: textPdf([["FICTIONAL DEMO DOCUMENT", "Operating Authority Certificate", "Carrier: Ironwood Transport", "MC-998214  USDOT 2947716", "Authority type: Common (Property)"]]), meta: { category: "OPERATING_AUTHORITY", title: "Operating authority certificate", visibility: "SHARED", customerVisible: true } }));
  const ironCoi = await as("ops@ironwood.demo", (c) => uploadDocument(c, { orgLevel: true, filename: "ironwood-coi.pdf", data: textPdf([["FICTIONAL DEMO DOCUMENT", "Certificate of Liability Insurance", "Insured: Ironwood Transport", "Auto liability: $1,000,000 combined single limit", "Cargo: $100,000"]]), meta: { category: "INSURANCE_CERTIFICATE", title: "Certificate of insurance", visibility: "SHARED", customerVisible: true } }));
  const r1 = await as("ops@ironwood.demo", (c) => addComplianceRecord(c, { type: "OPERATING_AUTHORITY", identifier: "MC-998214", documentId: ironAuthDoc.document.id, effectiveDate: h(-24 * 900), expiresAt: null, coverageMinor: null, notes: null }));
  const r2 = await as("ops@ironwood.demo", (c) => addComplianceRecord(c, { type: "AUTO_LIABILITY_INSURANCE", identifier: "POL-IW-55120", documentId: ironCoi.document.id, coverageMinor: 1_000_000_00, effectiveDate: h(-24 * 200), expiresAt: h(24 * 165), notes: null }));
  await as("ops@ironwood.demo", (c) => addComplianceRecord(c, { type: "CARGO_INSURANCE", identifier: "POL-IW-55121", documentId: ironCoi.document.id, coverageMinor: 100_000_00, effectiveDate: h(-24 * 200), expiresAt: h(24 * 25), notes: "Renewal in progress" }));
  for (const r of [r1, r2]) await as("priya@meridian.demo", (c) => verifyComplianceRecord(c, r.id, { result: "VERIFIED", method: "MANUAL_DOCUMENT_REVIEW", notes: "Reviewed uploaded certificate against policy details." }));
  await as("ops@desertsun.demo", (c) => addComplianceRecord(c, { type: "AUTO_LIABILITY_INSURANCE", identifier: "POL-DS-8812", coverageMinor: 1_000_000_00, effectiveDate: h(-24 * 100), expiresAt: h(24 * 260), documentId: null, notes: null }));
  await as("ops@desertsun.demo", (c) => addComplianceRecord(c, { type: "OPERATING_AUTHORITY", identifier: "MC-1102357", effectiveDate: h(-24 * 1500), expiresAt: null, coverageMinor: null, documentId: null, notes: null }));
  await as("ops@bluegrass.demo", (c) => addComplianceRecord(c, { type: "AUTO_LIABILITY_INSURANCE", identifier: "POL-BG-2210", coverageMinor: 1_000_000_00, effectiveDate: h(-24 * 380), expiresAt: h(-24 * 15), documentId: null, notes: null }));
  for (const type of ["OPERATING_AUTHORITY", "AUTO_LIABILITY_INSURANCE"] as const) {
    const rec = await as("jay@redline.demo", (c) => addComplianceRecord(c, { type, identifier: type === "OPERATING_AUTHORITY" ? "MC-1040219" : "POL-RL-7781", coverageMinor: type === "OPERATING_AUTHORITY" ? null : 1_000_000_00, effectiveDate: h(-24 * 300), expiresAt: type === "OPERATING_AUTHORITY" ? null : h(24 * 300), documentId: null, notes: null }));
    await as("priya@meridian.demo", (c) => verifyComplianceRecord(c, rec.id, { result: "VERIFIED", method: "DEMO_ADAPTER", notes: "Demonstration adapter — no external lookup performed." }));
  }
  await db.update(t.complianceRecords).set({ status: "EXPIRED" }).where(sql`expires_at < now()`);

  const stop = (kind: string, name: string, city: string, state: string, start: Date, end: Date, extra: Record<string, unknown> = {}) => ({
    kind: kind as "PICKUP",
    name,
    city,
    state: state as "IL",
    windowStart: start,
    windowEnd: end,
    address1: null,
    postalCode: null,
    contactName: null,
    contactPhone: null,
    reference: null,
    notes: null,
    ...extra,
  });
  const baseShipment = { customerReference: null, requiresCustoms: false, commodity: null, equipmentType: null, accessorials: [], hazmat: false, temperatureMinF: null, temperatureMaxF: null, specialInstructions: null, currency: "USD" as const, targetBudgetMinor: null, quoteVisibility: "MARKETPLACE" as const, invitedProviderOrgIds: [], items: [], vehicles: [], submit: false };
  const item = (description: string, quantity: number, weightLb: number, extra: Record<string, unknown> = {}) => ({ description, quantity, packaging: "PALLET" as const, lengthIn: 48, widthIn: 40, heightIn: 60, weightLb, freightClass: null, stackable: true, hazmat: false, ...extra });
  const line = (code: string, description: string, dollars: number, qty = 1000) => ({ code: code as "LINEHAUL", description, quantityMilli: qty, unitAmountMinor: Math.round(dollars * 100) });
  const legsOf = async (shipmentId: string) => db.select().from(t.shipmentLegs).where(eq(t.shipmentLegs.shipmentId, shipmentId)).orderBy(t.shipmentLegs.seq);
  const demoPing = async (shipmentId: string, legId: string, lat: number, lng: number, label: string, hoursAgo: number) =>
    db.insert(t.locationPings).values({ shipmentId, legId, lat, lng, source: "DEMO", label, recordedAt: h(-hoursAgo) });

  /* ------------------------------------------------------------ 1. FTL in transit via broker */
  console.log("Shipment 1: FTL in transit (broker → carrier)…");
  const s1 = await as("leo@lakeshore.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "FTL",
      title: "Spring patio collection to Dallas DC",
      customerReference: "PO-44817",
      commodity: "Boxed outdoor furniture",
      equipmentType: "DRY_VAN",
      accessorials: ["APPOINTMENT"],
      stops: [stop("PICKUP", "Lakeshore Joliet DC", "Joliet", "IL", h(-30), h(-26)), stop("DELIVERY", "Lakeshore Dallas DC", "Dallas", "TX", h(10), h(14))],
      items: [item("Patio sets, boxed", 22, 18400), item("Umbrella bases", 4, 3200)],
      submit: true,
    }),
  );
  const q1 = await as("dana@meridian.demo", (c) => submitQuote(c, s1.id, { currency: "USD", lines: [line("LINEHAUL", "Linehaul Joliet IL → Dallas TX", 2450), line("FUEL_SURCHARGE", "Fuel surcharge", 412.5), line("ACCESSORIAL", "Delivery appointment", 75)], estimatedCostMinor: 2_480_00, transitDays: 2, notes: "Team of vetted carriers on this lane." }));
  await as("ops@ironwood.demo", (c) => submitQuote(c, s1.id, { currency: "USD", lines: [line("LINEHAUL", "Linehaul", 2690), line("FUEL_SURCHARGE", "Fuel surcharge", 430)], transitDays: 2, notes: null }));
  await as("maya@lakeshore.demo", (c) => acceptQuote(c, q1.id));
  const [leg1] = await legsOf(s1.id);
  const tender1 = await as("dana@meridian.demo", (c) => createTender(c, s1.id, { legId: leg1.id, carrierOrgId: org.ironwood.id, rateMinor: 2_350_00, currency: "USD", notes: "Appointment at delivery; call 1h out.", expiresInHours: 24 }));
  await as("ops@ironwood.demo", (c) => respondToTender(c, tender1.id, true, null));
  await as("ops@ironwood.demo", (c) => dispatchLeg(c, s1.id, { legId: leg1.id, driverId: driver["Carlos Mendez"], equipmentId: unit["IW-201"] }));
  await as("carlos@ironwood.demo", (c) => recordLegMilestone(c, s1.id, leg1.id, { status: "AT_PICKUP", occurredAt: h(-28), note: null, podSignerName: null, lat: 41.525, lng: -88.0817, locationSource: "MANUAL" }));
  await as("carlos@ironwood.demo", (c) => recordLegMilestone(c, s1.id, leg1.id, { status: "PICKED_UP", occurredAt: h(-27), note: "26 pallets, seal 448120", podSignerName: null, lat: 41.525, lng: -88.0817, locationSource: "MANUAL" }));
  await as("carlos@ironwood.demo", (c) => recordLegMilestone(c, s1.id, leg1.id, { status: "IN_TRANSIT", occurredAt: h(-26.5), note: null, podSignerName: null }));
  for (const [lat, lng, label, ago] of [
    [39.7817, -89.6501, "I-55 near Springfield, IL", 23],
    [38.627, -90.1994, "St. Louis, MO", 20],
    [37.0842, -94.5133, "Joplin, MO", 14],
    [35.4676, -97.5164, "Oklahoma City, OK", 9],
  ] as const)
    await demoPing(s1.id, leg1.id, lat, lng, label, ago);
  await db.update(t.shipmentLegs).set({ etaAt: h(12) }).where(eq(t.shipmentLegs.id, leg1.id));
  await as("leo@lakeshore.demo", (c) => postMessage(c, s1.id, { body: "Dallas DC confirmed the delivery appointment for tomorrow morning. Please have the driver call 1 hour out.", visibility: "SHARED", aiDrafted: false }));
  await as("dana@meridian.demo", (c) => postMessage(c, s1.id, { body: "Carrier margin is thin on this lane; consider repricing next quarter.", visibility: "INTERNAL", aiDrafted: false }));
  await as("leo@lakeshore.demo", (c) => createTrackingLink(c, s1.id, { label: "Dallas DC receiving", expiresInDays: 14 }));

  /* ------------------------------------------------------------ 2. International port-to-door with customs */
  console.log("Shipment 2: international import with customs…");
  const s2 = await as("leo@lakeshore.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "PORT_TO_DOOR",
      title: "Ceramic dinnerware import — Long Beach to Ontario",
      customerReference: "PO-45102",
      requiresCustoms: true,
      commodity: "Ceramic tableware",
      equipmentType: "CONTAINER_CHASSIS_40",
      accessorials: ["DRAYAGE"],
      stops: [stop("PORT", "Pier T Terminal", "Long Beach", "CA", h(50), h(74)), stop("DELIVERY", "Lakeshore Inland Empire DC", "Ontario", "CA", h(76), h(96))],
      items: [item("Ceramic dinnerware sets (cartons on pallets)", 18, 24600)],
      international: { portOfEntry: "Long Beach, CA", vesselVoyage: "MSC ARIANE / 442E", containerNumber: "MSKU4829173", billOfLadingNumber: "MEDU8829120", countryOfOrigin: "VN", portEta: h(48) },
      submit: true,
    }),
  );
  await as("maya@lakeshore.demo", (c) => appointCustomsBroker(c, s2.id, org.harborline.id));
  await as("ruth@harborline.demo", (c) => openCustomsEntry(c, s2.id, { portOfEntry: "Long Beach, CA", arrivalAt: h(48), importerName: "Lakeshore Home Goods", assignedToUserId: null, brokerNotes: null }));
  const ci = await as("leo@lakeshore.demo", (c) =>
    uploadDocument(c, {
      shipmentId: s2.id,
      filename: "commercial-invoice-HV-2026-0381.pdf",
      data: textPdf([
        [
          "FICTIONAL DEMONSTRATION DOCUMENT",
          "COMMERCIAL INVOICE",
          "Invoice No: HV-2026-0381",
          "Invoice Date: 2026-09-28",
          "Seller: Hoa Viet Ceramics Co., Ltd., Binh Duong, Vietnam",
          "Buyer: Lakeshore Home Goods, Chicago, IL, USA",
          "Incoterms: FOB Ho Chi Minh City",
          "Country of Origin: Vietnam",
          "Container: MSKU4829173",
          "Packages: 412 cartons",
          "Gross Weight: 11,180 kg",
          "Currency: USD",
          "Description: Stoneware dinnerware sets, 16-piece, assorted glazes",
          "Line 1 | Part HV-DS16-BLU | Stoneware dinnerware 16pc blue | Qty 1,200 | Unit 18.50 | Amount 22,200.00 | Origin VN",
          "Line 2 | Part HV-DS16-GRN | Stoneware dinnerware 16pc green | Qty 960 | Unit 18.50 | Amount 17,760.00 | Origin VN",
          "Line 3 | Part HV-MUG-4 | Stoneware mug set, 4-piece | Qty 1,500 | Unit 6.00 | Amount 9,000.00 | Origin VN",
          "Total Invoice Value: USD 48,960.00",
        ],
      ]),
      meta: { category: "COMMERCIAL_INVOICE", title: "Commercial invoice HV-2026-0381", visibility: "SHARED", customerVisible: true },
    }),
  );
  const pl = await as("leo@lakeshore.demo", (c) =>
    uploadDocument(c, {
      shipmentId: s2.id,
      filename: "packing-list.txt",
      data: Buffer.from(
        "FICTIONAL DEMONSTRATION DOCUMENT\nPACKING LIST\nExporter: Hoa Viet Ceramics Co., Ltd.\nConsignee: Lakeshore Home Goods\nContainer: MSKU4829173\nTotal packages: 412 cartons\nGross weight: 11,640 kg\nCountry of origin: Vietnam\n",
      ),
      meta: { category: "PACKING_LIST", title: "Packing list", visibility: "SHARED", customerVisible: true },
    }),
  );
  for (const d of [ci, pl]) {
    const ex = await as("ruth@harborline.demo", (c) => requestExtraction(c, d.document.id));
    await runExtraction(db, ex.id);
  }
  await db.delete(t.jobs).where(eq(t.jobs.type, "document.extract"));

  /* ------------------------------------------------------------ 2b. Customs brokerage desk (Harborline) */
  console.log("Customs brokerage: clients, library, deadlines, pre-filing review…");
  const ILLUSTRATIVE = "[Demo] Illustrative precedent for this demonstration only. Not a classification determination; verify against the current HTSUS.";
  const [entry2] = await db.select().from(t.customsEntries).where(eq(t.customsEntries.shipmentId, s2.id));
  const lakeshoreClientId = entry2.clientId!;
  await as("ruth@harborline.demo", (c) =>
    updateClient(c, lakeshoreClientId, {
      status: "ACTIVE",
      iorNumber: "36-4829103-00",
      bondType: "CONTINUOUS",
      bondNumber: "DEMO-CB-118204",
      suretyName: "Granite Mutual Surety (fictional)",
      bondAmountMinor: 50_000_00,
      bondExpiresAt: h(24 * 210),
      bondSource: "DOCUMENT_REVIEWED",
      entryFeeMinor: 125_00,
      perLineFeeMinor: 4_50,
      isfFeeMinor: 35_00,
      notes: "Fictional demo client.",
    }),
  );
  const poa = await as("maya@lakeshore.demo", (c) =>
    uploadDocument(c, {
      shipmentId: s2.id,
      filename: "customs-power-of-attorney.pdf",
      data: textPdf([["FICTIONAL DEMONSTRATION DOCUMENT", "CUSTOMS POWER OF ATTORNEY", "Grantor: Lakeshore Home Goods", "Agent: Harborline Customs Brokerage", "Signed: Maya Okafor, Owner"]]),
      meta: { category: "POWER_OF_ATTORNEY", title: "Customs power of attorney", visibility: "SHARED", customerVisible: true },
    }),
  );
  await as("ruth@harborline.demo", (c) => setPowerOfAttorney(c, lakeshoreClientId, { status: "VERIFIED", documentId: poa.document.id, signedAt: h(-24 * 300), expiresAt: h(24 * 65) }));
  for (const item of [
    { partNumber: "HV-DS16-BLU", description: "Stoneware dinnerware set, 16-piece, cobalt blue glaze", htsCode: "6912.00.4810" },
    { partNumber: "HV-MUG-4", description: "Stoneware mug set, 4-piece", htsCode: "6912.00.4400" },
  ]) {
    const it = await as("ben@harborline.demo", (c) => createClassification(c, { clientId: lakeshoreClientId, ...item, countryOfOrigin: "VN", rationale: ILLUSTRATIVE, source: "BROKER" }));
    await as("ruth@harborline.demo", (c) => decideClassification(c, it.id, "APPROVED"));
  }
  await as("ben@harborline.demo", (c) =>
    createClassification(c, { clientId: lakeshoreClientId, partNumber: "LS-VOT-12", description: "Glass votive candle holder, clear, set of 12", htsCode: "7013.99.5000", countryOfOrigin: "CN", rationale: `${ILLUSTRATIVE} Draft awaiting licensed-broker approval.`, source: "BROKER" }),
  );
  await as("ben@harborline.demo", (c) => updateEntryDetails(c, entry2.id, { entryType: "01", modeOfTransport: "OCEAN", vesselDepartureAt: h(-24 * 16), arrivalAt: h(48) }));
  const [isf2] = await db.select().from(t.customsDeadlines).where(eq(t.customsDeadlines.entryId, entry2.id)).then((r) => r.filter((d) => d.ruleKey === "ISF"));
  if (isf2) await as("ben@harborline.demo", (c) => setDeadlineStatus(c, isf2.id, { status: "MET", note: "[Demo] ISF transmitted by the importer's filer (fictional)." }));
  const [ciEx] = await db.select().from(t.documentExtractions).where(eq(t.documentExtractions.documentId, ci.document.id));
  await as("ben@harborline.demo", (c) => createLinesFromExtraction(c, entry2.id, ciEx.id, ciEx.lineItems.map((_, i) => i)));
  await as("ben@harborline.demo", (c) => setCustomsStatus(c, entry2.id, { status: "IN_REVIEW" }));
  // The licensed broker confirms the two lines that matched approved precedent; line 2 is a new SKU left for review.
  for (const l of await db.select().from(t.customsLines).where(eq(t.customsLines.entryId, entry2.id))) {
    if (!l.classificationItemId) continue;
    await as("ruth@harborline.demo", (c) =>
      upsertCustomsLine(c, entry2.id, { partNumber: l.partNumber, description: l.description, htsCode: l.htsCode, quantity: l.quantity, valueMinor: l.valueMinor, countryOfOrigin: l.countryOfOrigin, dutyRateBp: null, brokerReviewed: true }, l.id),
    );
  }
  await as("ruth@harborline.demo", (c) => runPreflightReview(c, entry2.id));
  await as("ruth@harborline.demo", (c) => askFile(c, entry2.id, "What is the invoice total and who is the seller?"));

  // A second importer, still onboarding: no power of attorney or bond yet.
  await as("ruth@harborline.demo", (c) => createClient(c, { name: "Pacific Crest Motors", importerOrgId: org.pacific.id, iorNumber: null, bondNumber: null, suretyName: null, status: "ONBOARDING", notes: "Fictional demo client. Waiting on signed POA and bond details." }));
  // A client that does not use Vicora, with a power of attorney about to expire.
  const sierra = await as("ruth@harborline.demo", (c) => createClient(c, { name: "Sierra Trail Outfitters (fictional)", iorNumber: "84-2290417-00", bondNumber: null, suretyName: null, status: "ACTIVE", bondType: "SINGLE_TRANSACTION", bondSource: "SELF_REPORTED", entryFeeMinor: 150_00, perLineFeeMinor: 5_00, notes: "Fictional demo client." }));
  await as("ruth@harborline.demo", (c) => setPowerOfAttorney(c, sierra.id, { status: "RECEIVED", signedAt: h(-24 * 350), expiresAt: h(24 * 12) }));

  await as("dana@meridian.demo", (c) => submitQuote(c, s2.id, { currency: "USD", lines: [line("DRAYAGE", "Port drayage Long Beach → Ontario", 685), line("CHASSIS", "Chassis (2 days)", 90, 2000), line("FUEL_SURCHARGE", "Fuel surcharge", 96)], estimatedCostMinor: 760_00, transitDays: 1, notes: "Includes pier pass." }));
  await as("ops@desertsun.demo", (c) => submitQuote(c, s2.id, { currency: "USD", lines: [line("DRAYAGE", "Drayage incl. chassis", 845), line("FUEL_SURCHARGE", "Fuel", 110)], transitDays: 1, notes: null }));

  /* ------------------------------------------------------------ 3. Multi-vehicle auto transport, picked up */
  console.log("Shipment 3: multi-vehicle auto transport…");
  const s3 = await as("kim@pacificcrest.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "AUTO_TRANSPORT",
      title: "Auction purchase — 3 units to Nashville store",
      customerReference: "PC-AUC-7731",
      stops: [stop("AUCTION", "Southland Auto Auction (fictional)", "Atlanta", "GA", h(-20), h(-14), { reference: "Gate pass GP-55821" }), stop("DEALERSHIP", "Pacific Crest Motors Nashville", "Nashville", "TN", h(4), h(30))],
      vehicles: [
        { vin: "1HGCV1F34PA012345", year: 2023, make: "Honda", model: "Accord", color: "Silver", operable: true, transportType: "OPEN", auctionReference: "Lot 2141", dealershipReference: null, notes: null },
        { vin: "5YJ3E1EA8NF123456", year: 2022, make: "Tesla", model: "Model 3", color: "White", operable: true, transportType: "OPEN", auctionReference: "Lot 2147", dealershipReference: null, notes: null },
        { vin: "1FTFW1E50MFA54321", year: 2021, make: "Ford", model: "F-150", color: "Blue", operable: false, transportType: "OPEN", auctionReference: "Lot 2160", dealershipReference: null, notes: "Does not start; winch required" },
      ],
      submit: true,
    }),
  );
  const q3 = await as("jay@redline.demo", (c) => submitQuote(c, s3.id, { currency: "USD", lines: [line("VEHICLE_TRANSPORT", "Open transport, per vehicle", 395, 3000), line("INOPERABLE_FEE", "Inoperable vehicle (winch)", 150)], estimatedCostMinor: 900_00, transitDays: 1, notes: null }));
  await as("kim@pacificcrest.demo", (c) => acceptQuote(c, q3.id));
  const veh3 = await db.select().from(t.vehicles).where(eq(t.vehicles.shipmentId, s3.id));
  await as("jay@redline.demo", (c) => createTrip(c, { name: "ATL → BNA Tue run", driverId: driver["Tasha Greene"], equipmentId: unit["RL-9A"], plannedStart: h(-18), vehicleIds: veh3.map((v) => v.id) }));
  const [leg3] = await legsOf(s3.id);
  await as("jay@redline.demo", (c) => dispatchLeg(c, s3.id, { legId: leg3.id, driverId: driver["Tasha Greene"], equipmentId: unit["RL-9A"] }));
  for (const [i, v] of veh3.entries()) {
    const photo = await as("tasha@redline.demo", (c) => uploadDocument(c, { shipmentId: s3.id, filename: `pickup-${v.vin.slice(-6)}-front.png`, data: solidPng(150 + i * 30, 160, 170), meta: { category: "VEHICLE_PHOTO", title: `Pickup photo — ${v.year} ${v.make} ${v.model}`, visibility: "SHARED", customerVisible: true } }));
    await as("tasha@redline.demo", (c) =>
      recordInspection(c, s3.id, {
        vehicleId: v.id,
        kind: "PICKUP",
        odometer: [18422, 31877, 64120][i],
        notes: i === 2 ? "Inoperable, winched on. Interior dusty." : null,
        signerName: "Auction yard attendant",
        signatureDocumentId: null,
        photoDocumentIds: [photo.document.id],
        lat: 33.749,
        lng: -84.388,
        damages: i === 1 ? [{ area: "Rear bumper", damageType: "SCRATCH", severity: "MINOR", photoDocumentId: photo.document.id, x: 0.62, y: 0.71, note: "3 in. scuff, pre-existing" }] : [],
      }),
    );
  }
  await as("tasha@redline.demo", (c) => recordLegMilestone(c, s3.id, leg3.id, { status: "PICKED_UP", occurredAt: h(-15), note: "All 3 units loaded", podSignerName: null, lat: 33.749, lng: -84.388, locationSource: "MANUAL" }));
  await demoPing(s3.id, leg3.id, 34.7698, -84.9702, "I-75 near Dalton, GA", 11);
  await demoPing(s3.id, leg3.id, 35.0456, -85.3097, "Chattanooga, TN", 9);

  /* ------------------------------------------------------------ 4. LTL delivered, invoiced and paid */
  console.log("Shipment 4: delivered, invoiced, sandbox payment…");
  const s4 = await as("leo@lakeshore.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "LTL",
      title: "Lamp restock — Memphis to Atlanta",
      customerReference: "PO-44702",
      equipmentType: "DRY_VAN",
      accessorials: ["LIFTGATE_DELIVERY"],
      stops: [stop("PICKUP", "Lakeshore Memphis Hub", "Memphis", "TN", h(-100), h(-96)), stop("DELIVERY", "Lakeshore Atlanta Store #12", "Atlanta", "GA", h(-80), h(-72))],
      items: [item("Table lamps, boxed", 6, 2100, { freightClass: "125" })],
      submit: true,
    }),
  );
  const q4 = await as("dana@meridian.demo", (c) => submitQuote(c, s4.id, { currency: "USD", lines: [line("LINEHAUL", "LTL linehaul, class 125", 640), line("ACCESSORIAL", "Liftgate at delivery", 85), line("FUEL_SURCHARGE", "Fuel surcharge", 104.4)], estimatedCostMinor: 610_00, transitDays: 2, notes: null }));
  await as("maya@lakeshore.demo", (c) => acceptQuote(c, q4.id));
  const [leg4] = await legsOf(s4.id);
  const tender4 = await as("dana@meridian.demo", (c) => createTender(c, s4.id, { legId: leg4.id, carrierOrgId: org.ironwood.id, rateMinor: 595_00, currency: "USD", notes: null, expiresInHours: 12 }));
  await as("ops@ironwood.demo", (c) => respondToTender(c, tender4.id, true, null));
  await as("ops@ironwood.demo", (c) => dispatchLeg(c, s4.id, { legId: leg4.id, driverId: driver["Denise Park"], equipmentId: unit["IW-202"] }));
  await as("ops@ironwood.demo", (c) => recordLegMilestone(c, s4.id, leg4.id, { status: "PICKED_UP", occurredAt: h(-98), note: null, podSignerName: null }));
  const pod = await as("ops@ironwood.demo", (c) => uploadDocument(c, { shipmentId: s4.id, filename: "pod-atlanta-store-12.pdf", data: textPdf([["FICTIONAL DEMONSTRATION DOCUMENT", "PROOF OF DELIVERY", "Delivered to: Lakeshore Atlanta Store #12", "6 pieces received in good condition", "Received by: J. Ortiz"]]), meta: { category: "PROOF_OF_DELIVERY", title: "Signed POD", visibility: "SHARED", customerVisible: true } }));
  await as("ops@ironwood.demo", (c) => recordLegMilestone(c, s4.id, leg4.id, { status: "DELIVERED", occurredAt: h(-76), note: null, podDocumentId: pod.document.id, podSignerName: "J. Ortiz" }));
  const inv = await as("sam@meridian.demo", (c) => createInvoice(c, { shipmentId: s4.id, dueInDays: 30, memo: "Thank you for your business." }));
  const pay = await as("ap@lakeshore.demo", (c) => payInvoice(c, inv.invoice.id, { idempotencyKey: "seed-pay-0001", sandboxOutcome: "succeed" }));
  await db.delete(t.jobs).where(eq(t.jobs.type, "sandbox.deliver_webhook"));
  await processPaymentWebhook(db, "sandbox", { id: "sbx_evt_seed_0001", type: "payment.succeeded", data: { providerPaymentId: pay.payment.providerPaymentId } });
  const [pbl] = await db.select().from(t.payables).where(eq(t.payables.shipmentId, s4.id));
  await as("sam@meridian.demo", (c) => approvePayable(c, pbl.id));
  await as("dana@meridian.demo", (c) => completeShipment(c, s4.id));

  /* ------------------------------------------------------------ 5. Missed pickup (exception-first demo) */
  console.log("Shipment 5: missed pickup window…");
  const s5 = await as("leo@lakeshore.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "FTL",
      title: "Rug inventory transfer to Atlanta",
      customerReference: "PO-45011",
      equipmentType: "DRY_VAN",
      stops: [stop("PICKUP", "Lakeshore Joliet DC", "Joliet", "IL", h(-8), h(-2)), stop("DELIVERY", "Lakeshore Atlanta DC", "Atlanta", "GA", h(20), h(28))],
      items: [item("Area rugs, rolled", 24, 16800)],
      submit: true,
    }),
  );
  const q5 = await as("ops@ironwood.demo", (c) => submitQuote(c, s5.id, { currency: "USD", lines: [line("LINEHAUL", "Linehaul Joliet → Atlanta", 1980), line("FUEL_SURCHARGE", "Fuel", 320)], transitDays: 2, notes: null, estimatedCostMinor: 1_700_00 }));
  await as("maya@lakeshore.demo", (c) => acceptQuote(c, q5.id));
  await as("leo@lakeshore.demo", (c) => openException(c, s5.id, { type: "DELAY", severity: "HIGH", title: "Truck did not arrive for pickup", description: "Dock reports no truck at the Joliet DC by end of window.", customerVisible: true, legId: null, vehicleId: null }));

  /* ------------------------------------------------------------ 6. Open marketplace request (load board) */
  const s6 = await as("kim@pacificcrest.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "AUTO_TRANSPORT",
      title: "Dealer trade — single SUV to Phoenix",
      stops: [stop("DEALERSHIP", "Partner dealer (fictional), Los Angeles", "Los Angeles", "CA", h(30), h(54)), stop("DELIVERY", "Customer residence", "Phoenix", "AZ", h(60), h(90))],
      vehicles: [{ vin: "5UXCR6C05N9K12345", year: 2022, make: "BMW", model: "X5", color: "Black", operable: true, transportType: "ENCLOSED", auctionReference: null, dealershipReference: "Trade #T-8812", notes: null }],
      submit: true,
    }),
  );
  /* ------------------------------------------------------------ 7. Draft */
  await as("leo@lakeshore.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "FTL",
      title: "Holiday candles — temperature controlled",
      equipmentType: "REEFER",
      temperatureMinF: 55,
      temperatureMaxF: 65,
      stops: [stop("PICKUP", "Candle supplier (fictional)", "Fresno", "CA", h(96), h(100)), stop("DELIVERY", "Lakeshore Denver DC", "Denver", "CO", h(130), h(140))],
      items: [item("Candles, cartons on pallets", 16, 12800)],
    }),
  );

  /* ------------------------------------------------------------ 8–9. More customs work for the brokerage desk */
  console.log("Shipments 8–9: customs imports for the brokerage desk…");
  const s8 = await as("kim@pacificcrest.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "PORT_TO_DOOR",
      title: "Aftermarket alloy wheels import — Tacoma to Nashville",
      requiresCustoms: true,
      commodity: "Aluminum alloy road wheels",
      equipmentType: "CONTAINER_CHASSIS_40",
      accessorials: ["DRAYAGE"],
      stops: [stop("PORT", "Husky Terminal (fictional berth)", "Tacoma", "WA", h(30), h(54)), stop("DELIVERY", "Pacific Crest Motors Nashville", "Nashville", "TN", h(150), h(170))],
      items: [item("Alloy wheels, palletized", 22, 19800)],
      international: { portOfEntry: "Tacoma, WA", vesselVoyage: "ONE HARMONY / 118E", containerNumber: "TGHU7712048", billOfLadingNumber: "ONEYTAC5512870", countryOfOrigin: "TW", portEta: h(30) },
      submit: true,
    }),
  );
  await as("kim@pacificcrest.demo", (c) => appointCustomsBroker(c, s8.id, org.harborline.id));
  const ben = (await db.select().from(t.users).where(eq(t.users.email, "ben@harborline.demo")))[0];
  const entry8 = await as("ruth@harborline.demo", (c) => openCustomsEntry(c, s8.id, { portOfEntry: "Tacoma, WA", arrivalAt: h(30), importerName: "Pacific Crest Motors", assignedToUserId: ben.id, brokerNotes: "Waiting on POA and bond before we can file." }));
  await as("ben@harborline.demo", (c) => updateEntryDetails(c, entry8.id, { entryType: "01", modeOfTransport: "OCEAN", vesselDepartureAt: h(-24 * 11), arrivalAt: h(30) }));
  await as("ben@harborline.demo", (c) => runPreflightReview(c, entry8.id));

  const s9 = await as("leo@lakeshore.demo", (c) =>
    createShipment(c, {
      ...baseShipment,
      serviceType: "PORT_TO_DOOR",
      title: "Glass votive holders import — Savannah to Atlanta",
      requiresCustoms: true,
      commodity: "Glass candle holders",
      equipmentType: "CONTAINER_CHASSIS_40",
      accessorials: ["DRAYAGE"],
      stops: [stop("PORT", "Garden City Terminal", "Savannah", "GA", h(24 * 9), h(24 * 10)), stop("DELIVERY", "Lakeshore Atlanta DC", "Atlanta", "GA", h(24 * 10 + 6), h(24 * 11))],
      items: [item("Glass votive holders, cartons on pallets", 14, 15400)],
      international: { portOfEntry: "Savannah, GA", vesselVoyage: "CMA CGM TAGE / 0FX7W", containerNumber: "CMAU5520913", billOfLadingNumber: "CMDUSHA2290441", countryOfOrigin: "CN", portEta: h(24 * 9) },
      submit: true,
    }),
  );
  await as("maya@lakeshore.demo", (c) => appointCustomsBroker(c, s9.id, org.harborline.id));

  console.log("Running queued notification jobs…");
  await db.delete(t.jobs).where(eq(t.jobs.type, "sandbox.deliver_webhook"));
  while ((await runDueJobs(200)) > 0) {
    /* drain */
  }
  console.log(`\nSeed complete. ${USERS.length} demo users, password: ${DEMO_PASSWORD}`);
  for (const u of USERS) console.log(`  ${u.email.padEnd(26)} ${u.orgs.map(([k, r]) => `${org[k].name} (${r.join(", ")})`).join("; ") || "Platform administrator"}`);
  void s6;
  void s9;
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
