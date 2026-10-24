import type { Metadata } from "next";
import { ActionButton } from "@/components/ui/client";
import { Badge, Card, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { PROVIDER_ORG_TYPES } from "@/lib/domain";
import { effectivePermissions, ORG_TYPE_CAPABILITIES, ROLE_LABEL, ROLES_FOR_ORG_TYPE, type Permission, type Role } from "@/lib/permissions";
import { relativeTime } from "@/lib/time";
import { load } from "@/server/page";
import { getPreferences } from "@/server/services/comms";
import { getOrgProfile, listMembers } from "@/server/services/orgs";
import { InviteForm, MemberEditor, NotificationPrefs, OrgSettingsForm } from "./forms";

export const metadata: Metadata = { title: "Team & settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "team";
  const d = await load(async (ctx) => ({
    team: ctx.perms.has("team.read") ? await listMembers(ctx) : null,
    profile: await getOrgProfile(ctx),
    prefs: await getPreferences(ctx),
    orgType: ctx.org.type,
    me: ctx.user.id,
    canTeam: ctx.perms.has("team.manage"),
    canOrg: ctx.perms.has("org.manage"),
  }));
  const allRoles = ROLES_FOR_ORG_TYPE[d.orgType];
  const allPerms = ORG_TYPE_CAPABILITIES[d.orgType] as Permission[];
  return (
    <>
      <PageHeader title="Team & settings" />
      <Tabs
        base="/settings"
        current={tab}
        tabs={[
          { key: "team", label: "Team" },
          { key: "organization", label: "Organization" },
          { key: "notifications", label: "My notifications" },
        ]}
      />
      {tab === "team" && d.team && (
        <div className="space-y-4">
          {d.team.members.map((m) => (
            <Card
              key={m.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {m.name} <span className="text-xs font-normal text-slate-500">{m.email}</span>
                  {m.status !== "ACTIVE" && <StatusBadge status="REJECTED" label={m.status.toLowerCase()} />}
                </span>
              }
            >
              <div className="mb-2 flex flex-wrap gap-1">
                {m.roles.map((r) => (
                  <Badge key={r} tone="blue">
                    {ROLE_LABEL[r as Role] ?? r}
                  </Badge>
                ))}
                {m.grants.length > 0 && <Badge tone="green">+{m.grants.length} granted</Badge>}
                {m.revocations.length > 0 && <Badge tone="red">−{m.revocations.length} revoked</Badge>}
              </div>
              {d.canTeam && m.userId !== d.me && (
                <MemberEditor
                  membershipId={m.id}
                  roles={m.roles as Role[]}
                  grants={m.grants as Permission[]}
                  revocations={m.revocations as Permission[]}
                  status={m.status}
                  allRoles={allRoles}
                  allPerms={allPerms}
                  effective={[...effectivePermissions(d.orgType, m.roles, m.grants, m.revocations)]}
                />
              )}
            </Card>
          ))}
          {d.canTeam && (
            <Card title="Invite a teammate">
              <InviteForm roles={allRoles} />
              {d.team.invites.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
                  {d.team.invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {i.email} · {i.roles.map((r) => ROLE_LABEL[r as Role] ?? r).join(", ")} · expires {relativeTime(i.expiresAt)}
                      </span>
                      <ActionButton path={`/team/invitations/${i.id}`} method="DELETE">
                        Revoke
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
      {tab === "organization" && (
        <Card title={d.profile.org.name}>
          {d.canOrg ? (
            <OrgSettingsForm
              org={{ name: d.profile.org.name, timezone: d.profile.org.timezone, documentRetentionDays: d.profile.org.documentRetentionDays }}
              profile={d.profile.profile}
              isProvider={PROVIDER_ORG_TYPES.includes(d.orgType)}
            />
          ) : (
            <p className="text-sm text-slate-500">Only organization owners can change these settings.</p>
          )}
        </Card>
      )}
      {tab === "notifications" && (
        <Card title="Notification preferences">
          <NotificationPrefs prefs={d.prefs.map((p) => ({ eventType: p.eventType, inApp: p.inApp, email: p.email }))} />
        </Card>
      )}
    </>
  );
}
