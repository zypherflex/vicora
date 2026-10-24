import { describe, expect, it } from "vitest";
import { rankProviders } from "@/server/services/compliance";
import { diffDamage } from "@/server/services/fleet";

const now = new Date("2026-10-24T12:00:00Z");
const future = new Date("2027-06-01T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");
const profile = (o: Partial<{ serviceTypes: string[]; equipmentTypes: string[]; serviceStates: string[]; acceptingLoads: boolean; onTimePct: number | null; completedLoads: number }> = {}) => ({
  serviceTypes: ["FTL"],
  equipmentTypes: ["DRY_VAN"],
  serviceStates: ["IL", "TX"],
  acceptingLoads: true,
  onTimePct: 96,
  completedLoads: 40,
  ...o,
});
const verified = (type: string, expiresAt: Date | null = future) => ({ type, status: "VERIFIED", expiresAt, verifiedAt: past, source: "MANUAL_DOCUMENT_REVIEW" });

describe("transparent provider matching", () => {
  const base = { serviceType: "FTL", equipmentType: "DRY_VAN", originState: "IL", destinationState: "TX", now };

  it("ranks eligible, verified, available providers first and explains every point", () => {
    const out = rankProviders({
      ...base,
      providers: [
        { orgId: "a", name: "Verified", type: "CARRIER", profile: profile(), available: [{ type: "DRY_VAN", available: 3 }], records: [verified("OPERATING_AUTHORITY"), verified("AUTO_LIABILITY_INSURANCE")] },
        { orgId: "b", name: "Self-reported", type: "CARRIER", profile: profile(), available: [{ type: "DRY_VAN", available: 3 }], records: [{ type: "OPERATING_AUTHORITY", status: "UNVERIFIED", expiresAt: future, verifiedAt: null, source: "SELF_REPORTED" }] },
        { orgId: "c", name: "Reefer only", type: "CARRIER", profile: profile({ equipmentTypes: ["REEFER"] }), available: [], records: [] },
      ],
    });
    expect(out.map((p) => p.orgId)).toEqual(["a", "b", "c"]);
    expect(out[0].score).toBe(25 + 25 + 30 + 16);
    expect(out[0].criteria.map((c) => c.key)).toEqual(["service_area", "availability", "verification", "performance"]);
    expect(out[1].criteria.find((c) => c.key === "verification")!.points).toBe(0);
    expect(out[1].verification.authority).toBe("Not verified");
    expect(out[2].eligible).toBe(false);
    expect(out[2].ineligibleReasons.join()).toMatch(/53' dry van/);
  });

  it("gives no verification credit for expired records and no history credit under five loads", () => {
    const [p] = rankProviders({
      ...base,
      providers: [{ orgId: "x", name: "X", type: "CARRIER", profile: profile({ completedLoads: 3 }), available: [], records: [verified("OPERATING_AUTHORITY", past)] }],
    });
    expect(p.verification.authority).toBe("Expired");
    expect(p.criteria.find((c) => c.key === "verification")!.points).toBe(0);
    expect(p.criteria.find((c) => c.key === "performance")!.detail).toMatch(/Insufficient history/);
  });

  it("excludes providers not accepting loads", () => {
    const [p] = rankProviders({ ...base, providers: [{ orgId: "x", name: "X", type: "CARRIER", profile: profile({ acceptingLoads: false }), available: [], records: [] }] });
    expect(p.eligible).toBe(false);
  });
});

describe("vehicle condition comparison", () => {
  const d = (area: string, damageType: string, severity = "MINOR") => ({ area, damageType, severity });
  it("reports only damage that was not on the pickup report", () => {
    const pickup = [d("Front bumper", "SCRATCH")];
    const delivery = [d("front bumper ", "SCRATCH"), d("Hood", "DENT", "MODERATE")];
    expect(diffDamage(pickup, delivery)).toEqual([d("Hood", "DENT", "MODERATE")]);
  });
  it("treats a different damage type in the same area as new", () => {
    expect(diffDamage([d("Hood", "SCRATCH")], [d("Hood", "DENT")])).toHaveLength(1);
  });
});
