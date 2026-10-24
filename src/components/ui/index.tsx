import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-brand-50 text-brand-700 ring-brand-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone])}>
      {children}
    </span>
  );
}

/** Marks fictional data so it is never mistaken for real records. */
export function DemoBadge({ label = "Demo data" }: { label?: string }) {
  return (
    <Badge tone="violet" title="Fictional data created by the seed script">
      {label}
    </Badge>
  );
}

/** Marks an integration that has no live connection configured. */
export function NotConnected({ what }: { what: string }) {
  return (
    <Badge tone="amber" title={`${what} is not connected. No data is sent to or received from a real service.`}>
      {what}: not connected
    </Badge>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "slate",
  QUOTE_REQUESTED: "amber",
  BOOKED: "blue",
  ASSIGNED: "blue",
  DISPATCHED: "blue",
  PICKED_UP: "violet",
  IN_TRANSIT: "violet",
  DELIVERED: "green",
  COMPLETED: "green",
  CANCELLED: "red",
  OPEN: "red",
  ACKNOWLEDGED: "amber",
  RESOLVED: "green",
  OFFERED: "amber",
  ACCEPTED: "green",
  DECLINED: "red",
  EXPIRED: "slate",
  WITHDRAWN: "slate",
  SUBMITTED: "blue",
  ISSUED: "blue",
  PARTIALLY_PAID: "amber",
  PAID: "green",
  VOID: "slate",
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  VERIFIED: "green",
  SELF_REPORTED: "amber",
  UNVERIFIED: "amber",
  ESTIMATED: "amber",
  CONFIRMED: "green",
  HOLD: "red",
  RELEASED: "green",
  CRITICAL: "red",
  HIGH: "red",
  MEDIUM: "amber",
  LOW: "slate",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{label ?? status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function ButtonLink({ href, children, variant = "primary", ...rest }: { href: string; children: ReactNode; variant?: "primary" | "secondary" } & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant)} {...rest}>
      {children}
    </Link>
  );
}

export function buttonClass(variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
    variant === "primary" && "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    variant === "secondary" && "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
    variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
    variant === "ghost" && "text-slate-600 hover:bg-slate-100",
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1.5 sm:block sm:border-0 sm:py-0">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-right font-medium text-slate-800 sm:text-left">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  // Cells don't wrap unless the caller sets its own whitespace utility (class order can't override it in Tailwind v4).
  return <td className={cx(!className?.includes("whitespace-") && "whitespace-nowrap", "px-3 py-2 align-top", className)}>{children}</td>;
}

export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: { key: string; label: string; count?: number }[] }) {
  return (
    <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?tab=${t.key}`}
          scroll={false}
          className={cx(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            current === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Notice({ tone = "blue", children }: { tone?: "blue" | "amber" | "red" | "green"; children: ReactNode }) {
  const c = { blue: "border-brand-100 bg-brand-50 text-brand-700", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-800", green: "border-emerald-200 bg-emerald-50 text-emerald-800" }[tone];
  return <div className={cx("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}
