/** Time-zone aware formatting. All timestamps are stored as UTC (timestamptz) and rendered in an explicit zone. */
export function formatInTimeZone(d: Date | string | null | undefined, timeZone = "America/Chicago", opts: { withZone?: boolean; dateOnly?: boolean } = {}) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(+date)) return "—";
  const base: Intl.DateTimeFormatOptions = opts.dateOnly
    ? { timeZone, month: "short", day: "numeric", year: "numeric" }
    : { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (opts.withZone !== false && !opts.dateOnly) base.timeZoneName = "short";
  return new Intl.DateTimeFormat("en-US", base).format(date);
}

export function relativeTime(d: Date | string | null | undefined, now = new Date()) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = +date - +now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return "just now";
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), "hour");
  return rtf.format(Math.round(diff / 86400_000), "day");
}

/** Convert a "YYYY-MM-DDTHH:mm" wall-clock value in a zone to a UTC Date. */
export function zonedWallTimeToUtc(local: string, timeZone: string): Date {
  const [datePart, timePart = "00:00"] = local.split("T");
  const [y, mo, da] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  // Offset of the zone at that instant, computed via Intl.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (asUtc - guess));
}

export const lbToKg = (lb: number) => Math.round(lb * 0.45359237);
export const kgToLb = (kg: number) => Math.round(kg / 0.45359237);

/** Primary IANA zone per state, used as the default for stop appointment windows (editable per stop). */
const STATE_ZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver", PR: "America/Puerto_Rico",
};
export function stateTimeZone(state: string | null | undefined): string {
  return (state && STATE_ZONES[state]) || "America/Chicago";
}
