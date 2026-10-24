import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { relativeTime } from "@/lib/time";
import { Badge, Empty } from "@/components/ui";
import type { AttentionItem } from "@/server/services/attention";

const TONE = { critical: "red", high: "red", medium: "amber", low: "slate" } as const;

export function AttentionList({ items, limit }: { items: AttentionItem[]; limit?: number }) {
  if (!items.length) return <Empty title="Nothing needs attention">Rules check missed windows, stale tracking, missing documents, expiring tenders and unpaid invoices.</Empty>;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="divide-y divide-slate-100">
      {shown.map((i) => (
        <li key={i.id} className="flex items-start gap-3 py-3">
          <AlertTriangle className={i.severity === "critical" || i.severity === "high" ? "mt-0.5 h-4 w-4 text-red-600" : "mt-0.5 h-4 w-4 text-amber-500"} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[i.severity]}>{i.severity}</Badge>
              {i.reference && <span className="text-xs font-medium text-slate-500">{i.reference}</span>}
              {i.at && <span className="text-xs text-slate-400">{relativeTime(i.at)}</span>}
            </div>
            <p className="mt-1 text-sm font-medium text-slate-800">{i.title}</p>
            <details className="mt-0.5 text-xs text-slate-500">
              <summary className="cursor-pointer select-none">Why this is flagged</summary>
              <ul className="mt-1 list-disc pl-4">
                {i.evidence.map((e, n) => (
                  <li key={n}>{e}</li>
                ))}
              </ul>
              <p className="mt-1 text-slate-400">Rule: {i.rule}</p>
            </details>
          </div>
          <Link href={i.action.href} className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            {i.action.label}
          </Link>
        </li>
      ))}
      {limit && items.length > limit && (
        <li className="pt-3 text-sm">
          <Link className="text-brand-600 hover:underline" href="/command?panel=attention">
            Show all {items.length}
          </Link>
        </li>
      )}
    </ul>
  );
}
