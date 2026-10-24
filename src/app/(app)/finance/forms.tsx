"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, newIdempotencyKey } from "@/lib/client/api";
import { parseToMinor } from "@/lib/money";
import { buttonClass, Notice } from "@/components/ui";
import { FormStatus, Submit, useSubmit } from "@/components/ui/client";

/**
 * Sandbox checkout. The idempotency key is created once per page view, so a double click or a
 * retry after a network error returns the same payment instead of charging twice.
 */
export function PayInvoice({ invoiceId, amountLabel }: { invoiceId: string; amountLabel: string }) {
  const { pending, error, ok, run } = useSubmit();
  const key = useRef(newIdempotencyKey());
  const [outcome, setOutcome] = useState<"succeed" | "decline">("succeed");
  return (
    <div className="space-y-3">
      <Notice tone="amber">
        Sandbox mode: no real money moves and no card details are collected. A live processor (e.g. a PCI-compliant hosted checkout) is not connected.
      </Notice>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="label">Simulated outcome</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={outcome === "succeed"} onChange={() => setOutcome("succeed")} /> Payment succeeds
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={outcome === "decline"} onChange={() => setOutcome("decline")} /> Card declined
        </label>
      </fieldset>
      <button
        disabled={pending}
        className={buttonClass("primary")}
        onClick={() => run(() => api(`/invoices/${invoiceId}/pay`, { body: { idempotencyKey: key.current, sandboxOutcome: outcome } }), "Payment submitted. Waiting for the processor's signed confirmation…", () => (key.current = newIdempotencyKey()))}
      >
        {pending ? "Submitting…" : `Pay ${amountLabel} (sandbox)`}
      </button>
      <FormStatus error={error} ok={ok} />
    </div>
  );
}

/** Refreshes server data while a payment awaits its webhook. */
export function AutoRefresh({ active, everyMs = 2000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}

export function CreditForm({ invoiceId }: { invoiceId: string }) {
  const { pending, error, ok, run } = useSubmit();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api(`/invoices/${invoiceId}/credits`, { body: { amountMinor: parseToMinor(f.get("amount") as string), reason: f.get("reason") } }), "Credit applied.", () => (e.target as HTMLFormElement).reset());
      }}
    >
      <input name="amount" required inputMode="decimal" className="field w-32" placeholder="Amount" aria-label="Credit amount" />
      <input name="reason" required className="field w-64" placeholder="Reason" aria-label="Reason" />
      <Submit pending={pending} variant="secondary">
        Issue credit
      </Submit>
      <FormStatus error={error} ok={ok} />
    </form>
  );
}

export function PayablePaid({ id }: { id: string }) {
  const { pending, error, run } = useSubmit();
  const [ref, setRef] = useState("");
  return (
    <span className="flex items-center gap-1">
      <input className="field w-36 py-1" placeholder="ACH / check ref" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Payment reference" />
      <button disabled={pending || ref.trim().length < 3} className={buttonClass("secondary", "sm")} onClick={() => run(() => api(`/payables/${id}/paid`, { body: { reference: ref } }))}>
        Record paid
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
