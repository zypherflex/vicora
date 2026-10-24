import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { setCustomsStatus, submitFiling } from "@/server/services/customs";
import { createInvoice } from "@/server/services/finance";
import { dispatchLeg } from "@/server/services/operations";
import { updateMember } from "@/server/services/orgs";
import { acceptQuote } from "@/server/services/quotes";
import { changeStatus, createShipment } from "@/server/services/shipments";
import { as } from "@/server/testing/actors";
import { codeOf, db, driverId, ftlInput, legsOf, orgId, shipmentByRef, unitId } from "./fixtures";

afterAll(closeDb);

async function membershipOf(email: string, org: string) {
  const [u] = await db().select().from(t.users).where(eq(t.users.email, email));
  const [m] = await db().select().from(t.memberships).where(and(eq(t.memberships.userId, u.id), eq(t.memberships.orgId, await orgId(org))));
  return m;
}

describe("role permissions", () => {
  it("blocks actions outside a role", async () => {
    const s4 = await shipmentByRef("VCR-26-001004");
    expect(await codeOf(as("ap@lakeshore.demo", (c) => createShipment(c, ftlInput("Accounting cannot book"))))).toBe("FORBIDDEN");
    expect(await codeOf(as("carlos@ironwood.demo", (c) => createInvoice(c, { shipmentId: s4.id, dueInDays: 30, memo: null })))).toBe("FORBIDDEN");
  });

  it("treats non-parties as not found even with the right permission", async () => {
    const s1 = await shipmentByRef("VCR-26-001001");
    const [leg] = await legsOf(s1.id);
    expect(await codeOf(as("ops@desertsun.demo", (c) => dispatchLeg(c, s1.id, { legId: leg.id, driverId: leg.driverId!, equipmentId: leg.equipmentId! })))).toBe("NOT_FOUND");
  });

  it("only the executing carrier can dispatch, and only with its own driver and equipment", async () => {
    const s1 = await shipmentByRef("VCR-26-001001");
    const [leg1] = await legsOf(s1.id);
    // Meridian (broker) is a party but not the executor.
    expect(await codeOf(as("dana@meridian.demo", (c) => dispatchLeg(c, s1.id, { legId: leg1.id, driverId: leg1.driverId!, equipmentId: leg1.equipmentId! })))).toBe("FORBIDDEN");
    // 001005 is booked directly with Ironwood and waiting for dispatch.
    const s5 = await shipmentByRef("VCR-26-001005");
    const [leg5] = await legsOf(s5.id);
    const [ownDriver, ownUnit, otherDriver] = await Promise.all([driverId("Denise Park"), unitId("IW-202"), driverId("Tasha Greene")]);
    expect(await codeOf(as("ops@ironwood.demo", (c) => dispatchLeg(c, s5.id, { legId: leg5.id, driverId: otherDriver, equipmentId: ownUnit })))).toBe("NOT_FOUND");
    expect(await codeOf(as("ops@ironwood.demo", (c) => dispatchLeg(c, s5.id, { legId: leg5.id, driverId: ownDriver, equipmentId: "00000000-0000-4000-8000-000000000000" })))).toBe("NOT_FOUND");
    // A leg already in transit cannot be re-dispatched.
    expect(await codeOf(as("ops@ironwood.demo", (c) => dispatchLeg(c, s1.id, { legId: leg1.id, driverId: ownDriver, equipmentId: ownUnit })))).toBe("CONFLICT");
  });

  it("applies per-member revocations and grants immediately", async () => {
    const leo = await membershipOf("leo@lakeshore.demo", "Lakeshore Home Goods");
    const s = await as("leo@lakeshore.demo", (c) => createShipment(c, ftlInput("Revocation test")));
    await as("maya@lakeshore.demo", (c) => updateMember(c, leo.id, { revocations: ["shipment.create"] }));
    expect(await codeOf(as("leo@lakeshore.demo", (c) => createShipment(c, ftlInput("Should fail"))))).toBe("FORBIDDEN");
    await as("maya@lakeshore.demo", (c) => updateMember(c, leo.id, { revocations: [] }));
    expect(await codeOf(as("leo@lakeshore.demo", (c) => createShipment(c, ftlInput("Works again"))))).toBe("OK");
    // Grants cannot exceed what the org type supports: a shipper can never submit quotes.
    await as("maya@lakeshore.demo", (c) => updateMember(c, leo.id, { grants: ["quote.submit"] }));
    const [row] = await db().select().from(t.memberships).where(eq(t.memberships.id, leo.id));
    expect(row.grants).toContain("quote.submit");
    const { authFor } = await import("@/server/testing/actors");
    expect((await authFor("leo@lakeshore.demo")).active!.permissions.has("quote.submit")).toBe(false);
    await as("maya@lakeshore.demo", (c) => updateMember(c, leo.id, { grants: [] }));
    void s;
  });

  it("only team managers change members, and the last owner cannot be removed", async () => {
    const leo = await membershipOf("leo@lakeshore.demo", "Lakeshore Home Goods");
    const maya = await membershipOf("maya@lakeshore.demo", "Lakeshore Home Goods");
    expect(await codeOf(as("leo@lakeshore.demo", (c) => updateMember(c, leo.id, { roles: ["OWNER"] })))).toBe("FORBIDDEN");
    expect(await codeOf(as("maya@lakeshore.demo", (c) => updateMember(c, maya.id, { roles: ["SHIPPER_OPS"] })))).toBe("CONFLICT");
  });

  it("suspended members lose access", async () => {
    const ap = await membershipOf("ap@lakeshore.demo", "Lakeshore Home Goods");
    await as("maya@lakeshore.demo", (c) => updateMember(c, ap.id, { status: "SUSPENDED" }));
    expect(await codeOf(as("ap@lakeshore.demo", async () => "x"))).toBe("FORBIDDEN");
    await as("maya@lakeshore.demo", (c) => updateMember(c, ap.id, { status: "ACTIVE" }));
    expect(await codeOf(as("ap@lakeshore.demo", async () => "x"))).toBe("OK");
  });

  it("reserves customs decisions for licensed brokers and never fakes a CBP filing", async () => {
    const [entry] = await db().select().from(t.customsEntries).where(eq(t.customsEntries.shipmentId, (await shipmentByRef("VCR-26-001002")).id));
    await db().update(t.customsEntries).set({ status: "DOCS_PENDING" }).where(eq(t.customsEntries.id, entry.id));
    // Customs staff can move the file into review but not mark it ready or file it.
    await as("ben@harborline.demo", (c) => setCustomsStatus(c, entry.id, { status: "IN_REVIEW" }));
    expect(await codeOf(as("ben@harborline.demo", (c) => setCustomsStatus(c, entry.id, { status: "READY_TO_FILE" })))).toBe("FORBIDDEN");
    expect(await codeOf(as("ben@harborline.demo", (c) => submitFiling(c, entry.id, "DEMO", true)))).toBe("FORBIDDEN");
    // Even a licensed broker needs every line reviewed first.
    expect(await codeOf(as("ruth@harborline.demo", (c) => setCustomsStatus(c, entry.id, { status: "READY_TO_FILE" })))).toBe("CONFLICT");
    expect(await codeOf(as("ruth@harborline.demo", (c) => submitFiling(c, entry.id, "DEMO", false)))).toBe("VALIDATION_FAILED");
    expect(await codeOf(as("ruth@harborline.demo", (c) => submitFiling(c, entry.id, "ACE_ABI", true)))).toBe("NOT_CONNECTED");
    expect(await codeOf(as("ruth@harborline.demo", (c) => submitFiling(c, entry.id, "DEMO", true)))).toBe("CONFLICT");
    // The shipper and other brokers cannot touch the file.
    expect(await codeOf(as("leo@lakeshore.demo", (c) => setCustomsStatus(c, entry.id, { status: "HOLD" })))).toBe("FORBIDDEN");
    await as("ruth@harborline.demo", (c) => setCustomsStatus(c, entry.id, { status: "DOCS_PENDING" }));
  });
});

describe("shipment status transitions", () => {
  it("follows the status model and records history", async () => {
    const { id } = await as("leo@lakeshore.demo", (c) => createShipment(c, ftlInput("Transition test", false)));
    expect(await codeOf(as("leo@lakeshore.demo", (c) => changeStatus(c, id, "BOOKED", null)))).toBe("INVALID_TRANSITION");
    await as("leo@lakeshore.demo", (c) => changeStatus(c, id, "QUOTE_REQUESTED", null));
    await as("leo@lakeshore.demo", (c) => changeStatus(c, id, "CANCELLED", "No longer needed"));
    expect(await codeOf(as("leo@lakeshore.demo", (c) => changeStatus(c, id, "QUOTE_REQUESTED", null)))).toBe("INVALID_TRANSITION");
    const hist = await db().select().from(t.shipmentStatusHistory).where(eq(t.shipmentStatusHistory.shipmentId, id)).orderBy(t.shipmentStatusHistory.changedAt);
    expect(hist.map((h) => `${h.fromStatus}->${h.toStatus}`)).toEqual(["null->DRAFT", "DRAFT->QUOTE_REQUESTED", "QUOTE_REQUESTED->CANCELLED"]);
    const [s] = await db().select().from(t.shipments).where(eq(t.shipments.id, id));
    expect(s.cancelledReason).toBe("No longer needed");
  });

  it("does not let a customer mark freight delivered or reopen a completed shipment", async () => {
    const s1 = await shipmentByRef("VCR-26-001001");
    const s4 = await shipmentByRef("VCR-26-001004");
    expect(await codeOf(as("leo@lakeshore.demo", (c) => changeStatus(c, s1.id, "DELIVERED", null)))).toBe("INVALID_TRANSITION");
    expect(await codeOf(as("leo@lakeshore.demo", (c) => changeStatus(c, s1.id, "CANCELLED", null)))).toBe("INVALID_TRANSITION");
    expect(await codeOf(as("maya@lakeshore.demo", (c) => changeStatus(c, s4.id, "CANCELLED", null)))).toBe("INVALID_TRANSITION");
  });

  it("cancelling an open request declines outstanding quotes and blocks acceptance", async () => {
    const s2 = await shipmentByRef("VCR-26-001006");
    const open = await db().select().from(t.quotes).where(and(eq(t.quotes.shipmentId, s2.id), eq(t.quotes.status, "SUBMITTED")));
    const owner = await db().select().from(t.organizations).where(eq(t.organizations.id, s2.ownerOrgId));
    const email = owner[0].name.startsWith("Pacific") ? "kim@pacificcrest.demo" : "leo@lakeshore.demo";
    await as(email, (c) => changeStatus(c, s2.id, "CANCELLED", "Test cancellation"));
    const after = await db().select().from(t.quotes).where(eq(t.quotes.shipmentId, s2.id));
    expect(after.every((q) => q.status !== "SUBMITTED")).toBe(true);
    if (open.length) expect(await codeOf(as(email, (c) => acceptQuote(c, open[0].id)))).toBe("CONFLICT");
  });
});
