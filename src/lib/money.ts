/**
 * Money is always represented as an integer number of minor units (cents)
 * plus an explicit ISO 4217 currency code. Never use floats for arithmetic.
 */
export const CURRENCIES = ["USD", "CAD", "MXN", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MINOR_UNITS: Record<Currency, number> = { USD: 2, CAD: 2, MXN: 2, EUR: 2 };

export interface Money {
  amountMinor: number;
  currency: Currency;
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} and ${b} amounts`);
    this.name = "CurrencyMismatchError";
  }
}

export function assertMinor(n: number, label = "amount"): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a safe integer of minor units, got ${n}`);
  return n;
}

export function money(amountMinor: number, currency: Currency): Money {
  return { amountMinor: assertMinor(amountMinor), currency };
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sum(items: Money[], currency: Currency): Money {
  return items.reduce((acc, m) => add(acc, m), money(0, currency));
}

/** Line amount = quantity × unit price. Quantity is expressed in thousandths to allow e.g. 1.5 hours of detention. */
export function lineAmount(quantityMilli: number, unitAmountMinor: number): number {
  assertMinor(quantityMilli, "quantityMilli");
  assertMinor(unitAmountMinor, "unitAmountMinor");
  // Round half away from zero to the nearest minor unit.
  const raw = quantityMilli * unitAmountMinor;
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(raw) / 1000);
}

/** Percentage of a value in basis points (1/100 of a percent), rounded half away from zero. */
export function applyBasisPoints(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  assertMinor(bps, "bps");
  const raw = amountMinor * bps;
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(raw) / 10000);
}

/** Margin in minor units and in basis points of revenue (null when revenue is zero). */
export function margin(revenueMinor: number, costMinor: number): { amountMinor: number; bps: number | null } {
  assertMinor(revenueMinor);
  assertMinor(costMinor);
  const amountMinor = revenueMinor - costMinor;
  const bps = revenueMinor === 0 ? null : Math.round((amountMinor * 10000) / revenueMinor);
  return { amountMinor, bps };
}

/** Parse a user-entered decimal string ("1,234.50") into minor units without float error. */
export function parseToMinor(input: string, currency: Currency = "USD"): number {
  const digits = MINOR_UNITS[currency];
  const cleaned = input.replace(/[,\s$]/g, "");
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!m) throw new Error(`Invalid amount "${input}"`);
  const [, neg, whole, frac = ""] = m;
  if (frac.length > digits) throw new Error(`Too many decimal places for ${currency}`);
  const minor = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  return assertMinor(neg ? -minor : minor);
}

export function formatMoney(amountMinor: number, currency: Currency | string): string {
  const digits = MINOR_UNITS[currency as Currency] ?? 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}

export function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}
