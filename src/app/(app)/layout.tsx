import { redirect } from "next/navigation";
import { NAV } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";
import { NotificationBell, OrgSwitcher, UserMenu } from "@/components/shell/topbar";
import { requireAuth } from "@/server/page";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  if (!auth.active) redirect("/login?reason=no-org");
  const m = auth.active;
  const items = NAV.filter((n) => n.show({ perms: m.permissions, orgType: m.orgType, roles: m.roles, isPlatformAdmin: auth.user.isPlatformAdmin })).map(({ href, label, icon }) => ({ href, label, icon }));
  return (
    <div className="min-h-screen lg:pl-60">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <Sidebar items={items} orgName={m.orgName} />
        <OrgSwitcher current={m.orgId} memberships={auth.memberships.map((x) => ({ orgId: x.orgId, orgName: x.orgName, orgType: x.orgType, isDemo: x.orgIsDemo }))} />
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <UserMenu name={auth.user.name} email={auth.user.email} isDemo={m.orgIsDemo} />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
