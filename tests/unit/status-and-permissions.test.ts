import { describe, expect, it } from "vitest";
import { canTransition, LEG_TRANSITIONS, SHIPMENT_STATUSES, SHIPMENT_TRANSITIONS } from "@/lib/domain";
import { effectivePermissions, ORG_TYPE_CAPABILITIES, ROLES_FOR_ORG_TYPE, ROLE_PERMISSIONS } from "@/lib/permissions";

describe("shipment status model", () => {
  it("allows only defined transitions, by actor", () => {
    expect(canTransition("DRAFT", "QUOTE_REQUESTED", "CUSTOMER")).toBe(true);
    expect(canTransition("DRAFT", "QUOTE_REQUESTED", "PROVIDER")).toBe(false);
    expect(canTransition("QUOTE_REQUESTED", "BOOKED", "CUSTOMER")).toBe(false); // only via quote acceptance
    expect(canTransition("QUOTE_REQUESTED", "BOOKED", "SYSTEM")).toBe(true);
    expect(canTransition("IN_TRANSIT", "DELIVERED", "EXECUTOR")).toBe(true);
    expect(canTransition("IN_TRANSIT", "DELIVERED", "CUSTOMER")).toBe(false);
    expect(canTransition("DELIVERED", "COMPLETED", "PROVIDER")).toBe(true);
    expect(canTransition("DRAFT", "DELIVERED")).toBe(false);
  });
  it("has terminal states and no way out of them", () => {
    expect(Object.keys(SHIPMENT_TRANSITIONS.COMPLETED)).toHaveLength(0);
    expect(Object.keys(SHIPMENT_TRANSITIONS.CANCELLED)).toHaveLength(0);
    for (const s of SHIPMENT_STATUSES) expect(canTransition(s, "DRAFT", "SYSTEM")).toBe(false);
  });
  it("cannot cancel once freight is moving", () => {
    for (const s of ["DISPATCHED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"] as const) expect(canTransition(s, "CANCELLED")).toBe(false);
  });
  it("leg transitions never skip back after pickup", () => {
    expect(LEG_TRANSITIONS.PICKED_UP).not.toContain("DISPATCHED");
    expect(LEG_TRANSITIONS.DELIVERED).toEqual([]);
  });
});

describe("permissions", () => {
  it("unions roles and grants, removes revocations", () => {
    const p = effectivePermissions("FREIGHT_BROKER", ["FREIGHT_BROKER_AGENT"], ["finance.manage"], ["margin.view"]);
    expect(p.has("tender.create")).toBe(true);
    expect(p.has("finance.manage")).toBe(true);
    expect(p.has("margin.view")).toBe(false);
  });
  it("caps permissions by organization type", () => {
    // A shipper owner holds every role permission, but shippers cannot tender or verify compliance.
    const p = effectivePermissions("SHIPPER", ["OWNER"]);
    expect(p.has("quote.accept")).toBe(true);
    expect(p.has("tender.create")).toBe(false);
    expect(p.has("compliance.verify")).toBe(false);
    expect(p.has("customs.approve")).toBe(false);
    // Granting something outside the org type's capabilities has no effect.
    expect(effectivePermissions("CARRIER", ["DRIVER"], ["customs.approve"]).has("customs.approve")).toBe(false);
  });
  it("keeps drivers narrow", () => {
    const p = effectivePermissions("CARRIER", ["DRIVER"]);
    expect(p.has("milestone.record")).toBe(true);
    expect(p.has("finance.read")).toBe(false);
    expect(p.has("team.manage")).toBe(false);
    expect(p.has("quote.submit")).toBe(false);
  });
  it("only licensed customs brokers can approve customs work", () => {
    expect(effectivePermissions("CUSTOMS_BROKER", ["CUSTOMS_STAFF"]).has("customs.approve")).toBe(false);
    expect(effectivePermissions("CUSTOMS_BROKER", ["CUSTOMS_BROKER_LICENSED"]).has("customs.approve")).toBe(true);
  });
  it("only offers roles whose permissions the org type can use", () => {
    for (const [type, roles] of Object.entries(ROLES_FOR_ORG_TYPE)) {
      for (const r of roles) {
        if (r === "OWNER" || r === "ADMIN") continue;
        const caps = new Set(ORG_TYPE_CAPABILITIES[type as keyof typeof ORG_TYPE_CAPABILITIES]);
        const usable = ROLE_PERMISSIONS[r].filter((p) => caps.has(p));
        expect(usable.length, `${r} in ${type}`).toBeGreaterThan(0);
      }
    }
  });
});
