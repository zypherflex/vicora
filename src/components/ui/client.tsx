"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { buttonClass, cx } from "./index";

/** A button that calls the API, then refreshes server data. Confirms first when `confirm` is set. */
export function ActionButton({
  path,
  method = "POST",
  body,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
  onDone,
  redirectTo,
  disabled,
}: {
  path: string;
  method?: string;
  body?: unknown;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  confirm?: string;
  onDone?: (r: unknown) => void;
  redirectTo?: string | ((r: never) => string);
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending || disabled}
        className={buttonClass(variant, size)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            try {
              const r = await api(path, { method, body: body ?? {} });
              onDone?.(r);
              if (redirectTo) router.push(typeof redirectTo === "function" ? redirectTo(r as never) : redirectTo);
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          });
        }}
      >
        {pending ? "Working…" : children}
      </button>
      {error && <span className="max-w-xs text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  function run(fn: () => Promise<unknown>, success?: string, after?: (r: unknown) => void) {
    setError(null);
    setOk(null);
    start(async () => {
      try {
        const r = await fn();
        if (success) setOk(success);
        after?.(r);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }
  return { pending, error, ok, run, setError };
}

export function FormStatus({ error, ok }: { error: string | null; ok?: string | null }) {
  if (error) return <p className="text-sm text-red-600" role="alert">{error}</p>;
  if (ok) return <p className="text-sm text-emerald-700">{ok}</p>;
  return null;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Submit({ pending, children, variant = "primary" }: { pending: boolean; children: ReactNode; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant)}>
      {pending ? "Working…" : children}
    </button>
  );
}
