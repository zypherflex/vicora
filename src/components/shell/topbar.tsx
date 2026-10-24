"use client";

import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { relativeTime } from "@/lib/time";
import { ORG_TYPE_LABEL, type OrgType } from "@/lib/domain";
import { Badge, cx } from "@/components/ui";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function OrgSwitcher({ current, memberships }: { current: string; memberships: { orgId: string; orgName: string; orgType: OrgType; isDemo: boolean }[] }) {
  const router = useRouter();
  if (memberships.length < 2) {
    const m = memberships[0];
    return (
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">{m?.orgName}</p>
        <p className="text-xs text-slate-500">{m ? ORG_TYPE_LABEL[m.orgType] : ""}</p>
      </div>
    );
  }
  return (
    <label className="min-w-0">
      <span className="sr-only">Active organization</span>
      <select
        className="max-w-[16rem] truncate rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium"
        value={current}
        onChange={async (e) => {
          await api("/auth/switch-org", { body: { orgId: e.target.value } });
          router.push("/command");
          router.refresh();
        }}
      >
        {memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName} · {ORG_TYPE_LABEL[m.orgType]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => {
    api<Notification[]>("/notifications").then(setItems).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="relative" ref={ref}>
      <button className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-brand-600 hover:underline" onClick={() => api("/notifications/read", { body: { ids: "all" } }).then(refresh)}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">You&apos;re all caught up.</li>}
            {items.map((n) => (
              <li key={n.id} className={cx("px-3 py-2", !n.readAt && "bg-brand-50/50")}>
                <Link
                  href={n.link ?? "#"}
                  onClick={() => {
                    setOpen(false);
                    if (!n.readAt) api("/notifications/read", { body: { ids: [n.id] } }).then(refresh);
                  }}
                  className="block"
                >
                  <p className="text-sm text-slate-800">{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-slate-400">{relativeTime(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/settings?tab=notifications" className="block border-t border-slate-100 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50" onClick={() => setOpen(false)}>
            Notification preferences
          </Link>
        </div>
      )}
    </div>
  );
}

export function UserMenu({ name, email, isDemo }: { name: string; email: string; isDemo: boolean }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      {isDemo && <Badge tone="violet">Demo organization</Badge>}
      <div className="hidden text-right sm:block">
        <p className="text-sm font-medium text-slate-800">{name}</p>
        <p className="text-xs text-slate-500">{email}</p>
      </div>
      <button
        className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          await api("/auth/logout", { body: {} });
          router.push("/login");
          router.refresh();
        }}
      >
        <LogOut className="h-5 w-5" />
      </button>
    </div>
  );
}
