import { describe, expect, it } from "vitest";
import { add, applyBasisPoints, CurrencyMismatchError, formatMoney, lineAmount, margin, money, parseToMinor, sum } from "@/lib/money";
import { computeInvoiceTotals } from "@/server/services/finance";

describe("money in integer minor units", () => {
  it("parses user input without float error", () => {
    expect(parseToMinor("1,234.50")).toBe(123450);
    expect(parseToMinor("$0.1")).toBe(10);
    expect(parseToMinor("19.99")).toBe(1999);
    expect(parseToMinor("-5")).toBe(-500);
    expect(() => parseToMinor("1.234")).toThrow(/decimal places/);
    expect(() => parseToMinor("abc")).toThrow(/Invalid amount/);
  });

  it("computes line amounts from milli-quantities with half-away-from-zero rounding", () => {
    expect(lineAmount(1000, 235000)).toBe(235000);
    expect(lineAmount(1500, 7500)).toBe(11250); // 1.5 h detention at $75
    expect(lineAmount(333, 100)).toBe(33);
    expect(lineAmount(335, 1)).toBe(0);
    expect(lineAmount(500, 1)).toBe(1); // 0.5 rounds away from zero
    expect(lineAmount(500, -1)).toBe(-1);
    expect(() => lineAmount(1.5, 100)).toThrow(RangeError);
  });

  it("applies basis points and computes margin", () => {
    expect(applyBasisPoints(100000, 1250)).toBe(12500);
    expect(applyBasisPoints(333, 5000)).toBe(167);
    expect(margin(265000, 235000)).toEqual({ amountMinor: 30000, bps: 1132 });
    expect(margin(0, 1000)).toEqual({ amountMinor: -1000, bps: null });
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money(100, "USD"), money(100, "CAD"))).toThrow(CurrencyMismatchError);
    expect(sum([money(100, "USD"), money(250, "USD")], "USD")).toEqual({ amountMinor: 350, currency: "USD" });
    expect(() => money(1.2, "USD")).toThrow(RangeError);
  });

  it("formats for display", () => {
    expect(formatMoney(123450, "USD")).toBe("$1,234.50");
  });
});

describe("invoice totals", () => {
  it("derives totals, balance and status", () => {
    expect(computeInvoiceTotals([50000, 12500], [], 0)).toEqual({ subtotalMinor: 62500, creditsMinor: 0, totalMinor: 62500, balanceMinor: 62500, status: "ISSUED" });
    expect(computeInvoiceTotals([50000, 12500], [2500], 20000)).toMatchObject({ totalMinor: 60000, balanceMinor: 40000, status: "PARTIALLY_PAID" });
    expect(computeInvoiceTotals([50000], [], 50000).status).toBe("PAID");
  });
  it("rejects credits above the subtotal and non-integer amounts", () => {
    expect(() => computeInvoiceTotals([1000], [1001], 0)).toThrow(/Credits cannot exceed/);
    expect(() => computeInvoiceTotals([10.5], [], 0)).toThrow(RangeError);
  });
});
