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
