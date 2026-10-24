/**
 * Pure customs-brokerage helpers shared by the server and the UI. Nothing here encodes tariff content:
 * Vicora validates formats and does arithmetic on values a licensed broker entered.
 */

/** HTSUS statistical reporting numbers are 10 digits, conventionally written 1234.56.7890. */
export function normalizeHts(input: string): string | null {
  const digits = input.replace(/[\s.\-]/g, "");
  if (!/^\d{10}$/.test(digits)) return null;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
}

export function htsChapter(hts: string): string {
  return hts.replace(/\D/g, "").slice(0, 2);
}

/** Show only the last four characters of an importer-of-record number. */
export function maskIor(ior: string | null | undefined): string {
  if (!ior) return "—";
  const clean = ior.trim();
  return clean.length <= 4 ? "••••" : `${"•".repeat(Math.min(clean.length - 4, 8))}${clean.slice(-4)}`;
}

/** Estimated ad valorem duty from a broker-entered rate in basis points. Rounds half up to the cent. */
export function estimateDutyMinor(valueMinor: number, rateBp: number): number {
  if (!Number.isSafeInteger(valueMinor) || !Number.isSafeInteger(rateBp) || valueMinor < 0 || rateBp < 0) throw new Error("Invalid duty inputs");
  return Math.floor((valueMinor * rateBp + 5000) / 10000);
}

export const ENTRY_TYPES: { code: string; label: string }[] = [
  { code: "01", label: "01 · Consumption, free and dutiable" },
  { code: "02", label: "02 · Consumption, quota/visa" },
  { code: "03", label: "03 · Consumption, AD/CVD" },
  { code: "06", label: "06 · Consumption, FTZ" },
  { code: "11", label: "11 · Informal, free and dutiable" },
  { code: "21", label: "21 · Warehouse" },
  { code: "61", label: "61 · Immediate transportation" },
];

/* ---------------------------------------------------------------- Deadlines */

export type DeadlineAnchor = "VESSEL_DEPARTURE" | "ARRIVAL" | "RELEASE" | "ENTRY_OPENED";

export interface DeadlineRuleInput {
  key: string;
  label: string;
  anchor: DeadlineAnchor;
  offsetDays: number;
  offsetHours: number;
  businessDays: boolean;
  modes: string[];
  reference: string | null;
  enabled: boolean;
}

/**
 * Starting rules offered to a new brokerage. They are a convenience, not regulatory advice: each one
 * shows its reference and must be reviewed by the brokerage, which can edit or disable it.
 */
export const DEFAULT_DEADLINE_RULES: DeadlineRuleInput[] = [
  {
    key: "ISF",
    label: "Importer Security Filing (ISF) transmitted",
    anchor: "VESSEL_DEPARTURE",
    offsetDays: 0,
    offsetHours: -24,
    businessDays: false,
    modes: ["OCEAN"],
    reference: "19 CFR 149.2(b): no later than 24 hours before lading at the foreign port. Verify against current CBP guidance.",
    enabled: true,
  },
  {
    key: "DOCS_COMPLETE",
    label: "Entry documents complete (internal target)",
    anchor: "ARRIVAL",
    offsetDays: -2,
    offsetHours: 0,
    businessDays: false,
    modes: [],
    reference: "Internal brokerage target, not a regulatory deadline.",
    enabled: true,
  },
  {
    key: "ENTRY_FILED",
    label: "Entry filed",
    anchor: "ARRIVAL",
    offsetDays: 15,
    offsetHours: 0,
    businessDays: false,
    modes: [],
    reference: "19 CFR 142.2: entry within 15 calendar days after arrival. Verify against current CBP guidance.",
    enabled: true,
  },
  {
    key: "ENTRY_SUMMARY",
    label: "Entry summary filed",
    anchor: "RELEASE",
    offsetDays: 10,
    offsetHours: 0,
    businessDays: true,
    modes: [],
    reference: "19 CFR 142.12(b): within 10 working days after release. Federal holidays are not excluded automatically. Verify against current CBP guidance.",
    enabled: true,
  },
];

/** Add whole business days (Mon–Fri, UTC calendar). Federal holidays are not excluded. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  const step = days >= 0 ? 1 : -1;
  let left = Math.abs(days);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function computeDueAt(rule: Pick<DeadlineRuleInput, "anchor" | "offsetDays" | "offsetHours" | "businessDays">, anchors: Partial<Record<DeadlineAnchor, Date | null>>): Date | null {
  const base = anchors[rule.anchor];
  if (!base) return null;
  const withDays = rule.businessDays ? addBusinessDays(base, rule.offsetDays) : new Date(base.getTime() + rule.offsetDays * 86400_000);
  return new Date(withDays.getTime() + rule.offsetHours * 3600_000);
}

export function deadlineState(dueAt: Date, status: string, now = new Date()): "done" | "overdue" | "due_soon" | "upcoming" {
  if (status !== "OPEN") return "done";
  const ms = dueAt.getTime() - now.getTime();
  if (ms < 0) return "overdue";
  if (ms < 48 * 3600_000) return "due_soon";
  return "upcoming";
}

/* ---------------------------------------------------------------- Precedent matching */

const STOP = new Set(["the", "and", "for", "with", "set", "sets", "of", "a", "an", "in", "pcs", "piece", "pieces", "assorted"]);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t))
      .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t)),
  );
}

export interface PrecedentCandidate {
  id: string;
  partNumber: string | null;
  description: string;
  htsCode: string;
  countryOfOrigin: string | null;
}

export interface PrecedentMatch<T extends PrecedentCandidate> {
  item: T;
  score: number;
  reasons: string[];
}

/**
 * Rank previously approved classifications by similarity to a line. Transparent: the score is the share
 * of overlapping description words, with an exact part-number match ranked first. It finds precedent;
 * it does not classify.
 */
export function matchPrecedents<T extends PrecedentCandidate>(line: { partNumber?: string | null; description: string; countryOfOrigin?: string | null }, library: T[], limit = 3): PrecedentMatch<T>[] {
  const lt = tokens(line.description);
  const out: PrecedentMatch<T>[] = [];
  for (const item of library) {
    const reasons: string[] = [];
    let score = 0;
    if (line.partNumber && item.partNumber && line.partNumber.trim().toUpperCase() === item.partNumber.trim().toUpperCase()) {
      score = 1;
      reasons.push(`Same part number ${item.partNumber}`);
    } else {
      const it = tokens(item.description);
      const inter = [...lt].filter((t) => it.has(t));
      const union = new Set([...lt, ...it]).size || 1;
      score = inter.length / union;
      if (inter.length) reasons.push(`Shared words: ${inter.slice(0, 6).join(", ")}`);
    }
    if (score <= 0.15) continue;
    if (line.countryOfOrigin && item.countryOfOrigin && line.countryOfOrigin.toUpperCase() !== item.countryOfOrigin.toUpperCase()) {
      reasons.push(`Different origin (${item.countryOfOrigin}); origin can change duty treatment`);
    }
    out.push({ item, score: Math.round(score * 100) / 100, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------------------------------------------------------------- Readiness */

export function readinessScore(findings: { severity: string; resolution: unknown }[]): number {
  let s = 100;
  for (const f of findings) {
    if (f.resolution) continue;
    if (f.severity === "BLOCKER") s -= 25;
    else if (f.severity === "WARNING") s -= 8;
  }
  return Math.max(0, s);
}

/** Parse a money-like string from a document ("USD 22,200.00", "$18.50") into minor units, or null. */
export function moneyFromText(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /-?[\d,]+(?:\.\d{1,2})?/.exec(v.replace(/\s/g, ""));
  if (!m) return null;
  const [whole, frac = ""] = m[0].replace(/,/g, "").split(".");
  const n = Number(whole) * 100 + Number((frac + "00").slice(0, 2)) * (whole.startsWith("-") ? -1 : 1);
  return Number.isSafeInteger(n) ? n : null;
}
