"use client";

import { Building2, CalendarClock, Handshake, Landmark, LayoutDashboard, ListChecks, Menu, Package, PlusCircle, Receipt, ScrollText, Settings, ShieldCheck, Smartphone, Truck, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "@/components/ui";

const ICONS = { Building2, CalendarClock, Handshake, Landmark, LayoutDashboard, ListChecks, Package, PlusCircle, Receipt, ScrollText, Settings, ShieldCheck, Smartphone, Truck, Users };

export function Sidebar({ items, orgName }: { items: { href: string; label: string; icon: string }[]; orgName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const matches = (href: string) => path === href || (href !== "/shipments" && path.startsWith(href + "/")) || (href === "/shipments" && /^\/shipments\/(?!new)/.test(path));
  // When nested items both match (e.g. /customs and /customs/clients), only the most specific is active.
  const active = (href: string) => matches(href) && !items.some((o) => o.href.length > href.length && o.href.startsWith(href + "/") && matches(o.href));
  const list = (
    <nav className="space-y-0.5">
      {items.map((i) => {
        const Icon = ICONS[i.icon as keyof typeof ICONS] ?? Package;
        return (
          <Link
            key={i.href}
            href={i.href}
            onClick={() => setOpen(false)}
            className={cx("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium", active(i.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <button className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
        <Menu className="h-5 w-5" />
      </button>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-slate-200 bg-white px-3 py-4 lg:block">
        <Link href="/command" className="mb-6 block px-3 text-xl font-bold tracking-tight text-brand-700">
          Vicora
        </Link>
        {list}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white px-3 py-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between px-3">
              <span className="text-xl font-bold text-brand-700">Vicora</span>
              <button aria-label="Close navigation" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 px-3 text-xs text-slate-500">{orgName}</p>
            {list}
          </aside>
        </div>
      )}
    </>
  );
}
