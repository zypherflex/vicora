"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** JSON (or multipart) call to the Vicora REST API with the session cookie. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers: init.form ? undefined : { "content-type": "application/json" },
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: "same-origin",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = json.error ?? {};
    throw new ApiError(res.status, e.code ?? "ERROR", formatError(e), e.details);
  }
  return json as T;
}

function formatError(e: { message?: string; details?: unknown }) {
  if (Array.isArray(e.details) && e.details.length) {
    return `${e.message ?? "Request failed"}: ${e.details
      .slice(0, 4)
      .map((d: { path?: string; message?: string }) => (d.path ? `${d.path} — ${d.message}` : d.message))
      .join("; ")}`;
  }
  return e.message ?? "Request failed";
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
