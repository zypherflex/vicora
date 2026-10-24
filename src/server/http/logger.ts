/** Structured JSON logger. One line per event, safe to ship to any log aggregator. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass(word)?|secret|token|authorization|cookie|card/i;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, REDACT.test(k) ? "[redacted]" : redact(x, depth + 1)]));
}

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const min = (process.env.LOG_LEVEL as Level) ?? "info";
  if (ORDER[level] < ORDER[min]) return;
  if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as object) });
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};
