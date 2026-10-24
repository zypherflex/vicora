import { describe, expect, it } from "vitest";
import { addBusinessDays, computeDueAt, DEFAULT_DEADLINE_RULES, deadlineState, estimateDutyMinor, maskIor, matchPrecedents, moneyFromText, normalizeHts, readinessScore } from "@/lib/customs";

describe("HTS and identifiers", () => {
  it("normalizes 10-digit HTS numbers and rejects anything else", () => {
    expect(normalizeHts("6912004810")).toBe("6912.00.4810");
    expect(normalizeHts("6912.00.48.10")).toBe("6912.00.4810");
    expect(normalizeHts("6912.00.48")).toBeNull();
    expect(normalizeHts("6912-00-4810-1")).toBeNull();
    expect(normalizeHts("ABCD004810")).toBeNull();
  });
  it("masks importer of record numbers", () => {
    expect(maskIor("36-4829103-00")).toMatch(/^•+3-00$/);
    expect(maskIor("123")).toBe("••••");
    expect(maskIor(null)).toBe("—");
  });
});

describe("money and duty arithmetic", () => {
  it("parses money from document text", () => {
    expect(moneyFromText("USD 22,200.00")).toBe(2_220_000);
    expect(moneyFromText("$18.5")).toBe(1850);
    expect(moneyFromText("9,000")).toBe(900_000);
    expect(moneyFromText("n/a")).toBeNull();
  });
  it("estimates ad valorem duty from a broker-entered rate, rounding half up to the cent", () => {
    expect(estimateDutyMinor(2_220_000, 600)).toBe(133_200); // 6.00% of $22,200.00
    expect(estimateDutyMinor(1, 5000)).toBe(1); // 0.5 cent rounds up
    expect(estimateDutyMinor(0, 1234)).toBe(0);
    expect(() => estimateDutyMinor(-1, 100)).toThrow();
    expect(() => estimateDutyMinor(100, 1.5)).toThrow();
  });
});

describe("deadlines", () => {
  const thu = new Date("2026-10-22T15:00:00Z"); // Thursday
  it("counts business days over weekends (holidays are not excluded)", () => {
    expect(addBusinessDays(thu, 1).toISOString().slice(0, 10)).toBe("2026-10-23");
    expect(addBusinessDays(thu, 2).toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(addBusinessDays(thu, 10).toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(addBusinessDays(thu, -4).toISOString().slice(0, 10)).toBe("2026-10-16");
  });
  it("computes due dates from the anchor each rule names", () => {
    const rule = (k: string) => DEFAULT_DEADLINE_RULES.find((r) => r.key === k)!;
    const departure = new Date("2026-10-01T12:00:00Z");
    const arrival = new Date("2026-10-20T08:00:00Z");
    expect(computeDueAt(rule("ISF"), { VESSEL_DEPARTURE: departure })?.toISOString()).toBe("2026-09-30T12:00:00.000Z");
    expect(computeDueAt(rule("ENTRY_FILED"), { ARRIVAL: arrival })?.toISOString()).toBe("2026-11-04T08:00:00.000Z");
    expect(computeDueAt(rule("ENTRY_SUMMARY"), { RELEASE: thu })?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(computeDueAt(rule("ENTRY_SUMMARY"), { ARRIVAL: arrival })).toBeNull();
  });
  it("every default rule carries a reference and none claims to be authoritative", () => {
    for (const r of DEFAULT_DEADLINE_RULES) {
      expect(r.reference).toBeTruthy();
      expect(r.reference).toMatch(/Verify against current CBP guidance|Internal brokerage target/);
    }
  });
  it("classifies deadline state", () => {
    const now = new Date("2026-10-24T00:00:00Z");
    expect(deadlineState(new Date("2026-10-23T00:00:00Z"), "OPEN", now)).toBe("overdue");
    expect(deadlineState(new Date("2026-10-25T00:00:00Z"), "OPEN", now)).toBe("due_soon");
    expect(deadlineState(new Date("2026-10-30T00:00:00Z"), "OPEN", now)).toBe("upcoming");
    expect(deadlineState(new Date("2026-10-23T00:00:00Z"), "MET", now)).toBe("done");
  });
});

describe("precedent matching", () => {
  const library = [
    { id: "a", partNumber: "HV-DS16-BLU", description: "Stoneware dinnerware set, 16-piece, cobalt blue glaze", htsCode: "6912.00.4810", countryOfOrigin: "VN" },
    { id: "b", partNumber: "HV-MUG-4", description: "Stoneware mug set, 4-piece", htsCode: "6912.00.4400", countryOfOrigin: "VN" },
    { id: "c", partNumber: "LS-VOT-12", description: "Glass votive candle holder, clear", htsCode: "7013.99.5000", countryOfOrigin: "CN" },
  ];
  it("ranks an exact part number first", () => {
    const m = matchPrecedents({ partNumber: "hv-mug-4", description: "Mugs" }, library);
    expect(m[0].item.id).toBe("b");
    expect(m[0].score).toBe(1);
  });
  it("finds similar descriptions, explains why, and flags a different origin", () => {
    const m = matchPrecedents({ partNumber: "HV-DS16-GRN", description: "Stoneware dinnerware 16pc green", countryOfOrigin: "CN" }, library);
    expect(m[0].item.id).toBe("a");
    expect(m[0].reasons.join(" ")).toMatch(/Shared words: .*stoneware/);
    expect(m[0].reasons.join(" ")).toMatch(/Different origin/);
    expect(m.find((x) => x.item.id === "c")).toBeUndefined();
  });
  it("returns nothing for unrelated products rather than guessing", () => {
    expect(matchPrecedents({ description: "Aluminum alloy road wheels" }, library)).toEqual([]);
  });
});

describe("readiness score", () => {
  it("drops for unresolved blockers and warnings only", () => {
    expect(readinessScore([])).toBe(100);
    expect(readinessScore([{ severity: "BLOCKER", resolution: null }, { severity: "WARNING", resolution: null }, { severity: "INFO", resolution: null }])).toBe(67);
    expect(readinessScore([{ severity: "BLOCKER", resolution: { status: "RESOLVED" } }])).toBe(100);
    expect(readinessScore(Array.from({ length: 6 }, () => ({ severity: "BLOCKER", resolution: null })))).toBe(0);
  });
});
