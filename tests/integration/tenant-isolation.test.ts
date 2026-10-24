import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withTenantTx } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { getShipmentTwin } from "@/server/services/shipments";
import { as } from "@/server/testing/actors";
import { codeOf, db, orgId, pgErrorOf, shipmentByRef } from "./fixtures";

/**
 * Tenant isolation is enforced twice: by the service layer and by PostgreSQL row-level security.
 * These tests query the database directly as the restricted application role, so they prove the
 * database itself refuses cross-tenant reads and writes even if a service check were missing.
 */
type Scope = { orgId: string; userId: string; orgType: string };
let desertSun: Scope;
let pacific: Scope;
let lakeshore: Scope;

async function scopeFor(email: string, org: string): Promise<Scope> {
  const [u] = await db().select().from(t.users).where(eq(t.users.email, email));
  const id = await orgId(org);
  const [o] = await db().select().from(t.organizations).where(eq(t.organizations.id, id));
  return { orgId: id, userId: u.id, orgType: o.type };
}

const count = async (scope: Scope, q: ReturnType<typeof sql>) => {
  const rows = await withTenantTx(scope, (tx) => tx.execute<{ n: number }>(q));
  return Number(rows[0].n);
};

beforeAll(async () => {
  desertSun = await scopeFor("ops@desertsun.demo", "Desert Sun Logistics");
  pacific = await scopeFor("kim@pacificcrest.demo", "Pacific Crest Motors");
  lakeshore = await scopeFor("leo@lakeshore.demo", "Lakeshore Home Goods");
});
afterAll(closeDb);

describe("row-level security (raw SQL as the application role)", () => {
  it("hides shipments an org is not a party to", async () => {
    const q = sql`select count(*)::int as n from shipments where reference in ('VCR-26-001001','VCR-26-001004','VCR-26-001007')`;
    expect(await count(desertSun, q)).toBe(0);
    expect(await count(pacific, q)).toBe(0);
    expect(await count(lakeshore, q)).toBe(3);
  });

  it("returns nothing at all when no tenant context is set", async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const [{ n }] = await client`select count(*)::int as n from shipments`;
      const [{ m }] = await client`select count(*)::int as m from invoices`;
      expect(n).toBe(0);
      expect(m).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("shows a provider only its own quotes, never competitors'", async () => {
    expect(await count(desertSun, sql`select count(*)::int as n from quotes`)).toBeGreaterThan(0);
    expect(await count(desertSun, sql`select count(*)::int as n from quotes where provider_org_id <> app_org()`)).toBe(0);
  });

  it("keeps invoices, charges and payments between the two parties", async () => {
    for (const scope of [desertSun, pacific]) {
      expect(await count(scope, sql`select count(*)::int as n from invoices`)).toBe(0);
      expect(await count(scope, sql`select count(*)::int as n from payments`)).toBe(0);
    }
    expect(await count(lakeshore, sql`select count(*)::int as n from invoices`)).toBeGreaterThan(0);
  });

  it("hides another tenant's documents and internal messages", async () => {
    const s1 = await shipmentByRef("VCR-26-001001");
    expect(await count(pacific, sql`select count(*)::int as n from documents where shipment_id = ${s1.id}`)).toBe(0);
    // Meridian posted an INTERNAL note on 001001; the shipper is a party but must not see it.
    expect(await count(lakeshore, sql`select count(*)::int as n from messages where shipment_id = ${s1.id} and visibility = 'INTERNAL'`)).toBe(0);
    const meridian = await scopeFor("dana@meridian.demo", "Meridian Freight Partners");
    expect(await count(meridian, sql`select count(*)::int as n from messages where shipment_id = ${s1.id} and visibility = 'INTERNAL'`)).toBe(1);
  });

  it("rejects writes into another tenant's shipment", async () => {
    const s1 = await shipmentByRef("VCR-26-001001");
    const updated = await withTenantTx(desertSun, (tx) => tx.execute(sql`update shipments set title = 'hijacked' where id = ${s1.id} returning id`));
    expect(updated.length).toBe(0);
    expect(
      await pgErrorOf(withTenantTx(desertSun, (tx) => tx.execute(sql`insert into shipment_events (shipment_id, type, title) values (${s1.id}, 'NOTE', 'injected')`))),
    ).toMatch(/row-level security/);
    expect(
      await pgErrorOf(withTenantTx(desertSun, (tx) => tx.execute(sql`insert into messages (shipment_id, org_id, body, visibility) values (${s1.id}, ${desertSun.orgId}, 'injected', 'SHARED')`))),
    ).toMatch(/row-level security/);
    const [after] = await db().select().from(t.shipments).where(eq(t.shipments.id, s1.id));
    expect(after.title).not.toBe("hijacked");
  });
});

describe("service layer isolation", () => {
  it("returns NOT_FOUND (not FORBIDDEN) for shipments outside the org, so existence is not leaked", async () => {
    const s1 = await shipmentByRef("VCR-26-001001");
    expect(await codeOf(as("ops@desertsun.demo", (c) => getShipmentTwin(c, s1.id)))).toBe("NOT_FOUND");
    expect(await codeOf(as("kim@pacificcrest.demo", (c) => getShipmentTwin(c, s1.id)))).toBe("NOT_FOUND");
  });

  it("hides carrier cost and broker margin from the shipper", async () => {
    const s1 = await shipmentByRef("VCR-26-001001");
    const shipperView = await as("leo@lakeshore.demo", (c) => getShipmentTwin(c, s1.id));
    expect(shipperView.finance).toBeNull();
    expect(shipperView.legs.every((l) => l.carrierRateMinor === null)).toBe(true);
    expect(shipperView.quotes.every((q) => q.estimatedCostMinor === null)).toBe(true);
    expect(shipperView.messages.some((m) => m.visibility === "INTERNAL")).toBe(false);

    const brokerView = await as("dana@meridian.demo", (c) => getShipmentTwin(c, s1.id));
    expect(brokerView.finance).not.toBeNull();
    expect(brokerView.finance!.marginMinor).toBe(brokerView.finance!.revenueMinor - brokerView.finance!.costMinor);
    expect(brokerView.legs[0].carrierRateMinor).toBe(2_350_00);
  });

  it("scopes a multi-org user to the active org only", async () => {
    // Alex is a viewer at Lakeshore (the shipper) and compliance staff at Meridian (the broker).
    const s1 = await shipmentByRef("VCR-26-001001");
    const s3 = await shipmentByRef("VCR-26-001003");
    const lakeshoreId = await orgId("Lakeshore Home Goods");
    const meridianId = await orgId("Meridian Freight Partners");
    const asShipper = await as("alex@consult.demo", (c) => getShipmentTwin(c, s1.id), lakeshoreId);
    const asBroker = await as("alex@consult.demo", (c) => getShipmentTwin(c, s1.id), meridianId);
    expect(asShipper.messages.some((m) => m.visibility === "INTERNAL")).toBe(false);
    expect(asBroker.messages.some((m) => m.visibility === "INTERNAL")).toBe(true);
    // Neither org is a party to the Pacific Crest auto shipment.
    expect(await codeOf(as("alex@consult.demo", (c) => getShipmentTwin(c, s3.id), lakeshoreId))).toBe("NOT_FOUND");
    expect(await codeOf(as("alex@consult.demo", (c) => getShipmentTwin(c, s3.id), meridianId))).toBe("NOT_FOUND");
  });
});
