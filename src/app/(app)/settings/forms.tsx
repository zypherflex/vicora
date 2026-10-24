"use client";

import { useState } from "react";
import { EQUIPMENT_LABEL, EQUIPMENT_TYPES, SERVICE_TYPES, SERVICE_TYPE_LABEL, US_STATES } from "@/lib/domain";
import { ROLE_LABEL, type Permission, type Role } from "@/lib/permissions";
import { api } from "@/lib/client/api";
import { buttonClass, cx, Notice } from "@/components/ui";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

export function InviteForm({ roles }: { roles: Role[] }) {
  const { pending, error, run } = useSubmit();
  const [picked, setPicked] = useState<Role[]>([]);
  const [link, setLink] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api<{ acceptUrl: string }>("/team/invitations", { body: { email: f.get("email"), roles: picked } }), undefined, (r) => setLink((r as { acceptUrl: string }).acceptUrl));
      }}
    >
      <Field label="Email">
        <input name="email" type="email" required className="field max-w-sm" />
      </Field>
      <fieldset>
        <legend className="label">Roles</legend>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <label key={r} className={cx("cursor-pointer rounded-full border px-3 py-1 text-xs", picked.includes(r) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300")}>
              <input type="checkbox" className="sr-only" checked={picked.includes(r)} onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, r] : xs.filter((x) => x !== r)))} />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <FormStatus error={error} />
      <button disabled={pending || !picked.length} className={buttonClass("primary")}>
        {pending ? "Sending…" : "Send invitation"}
      </button>
      {link && (
        <Notice tone="green">
          Invitation created. Email delivery is not connected, so the message is in the outbox. Share this link directly: <code className="break-all">{link}</code>
        </Notice>
      )}
    </form>
  );
}

/** Roles plus per-member grants and revocations. Effective permissions are capped by the org type. */
export function MemberEditor({ membershipId, roles, grants, revocations, status, allRoles, allPerms, effective }: { membershipId: string; roles: Role[]; grants: Permission[]; revocations: Permission[]; status: string; allRoles: Role[]; allPerms: Permission[]; effective: Permission[] }) {
  const { pending, error, ok, run } = useSubmit();
  const [r, setR] = useState(roles);
  const [g, setG] = useState(grants);
  const [v, setV] = useState(revocations);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {allRoles.map((x) => (
          <label key={x} className={cx("cursor-pointer rounded-full border px-3 py-1 text-xs", r.includes(x) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300")}>
            <input type="checkbox" className="sr-only" checked={r.includes(x)} onChange={(e) => setR((xs) => (e.target.checked ? [...xs, x] : xs.filter((y) => y !== x)))} />
            {ROLE_LABEL[x]}
          </label>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">Fine-tune permissions</summary>
        <p className="mt-2 text-xs text-slate-500">Grants add to the roles; revocations remove. Anything your organization type cannot do is ignored.</p>
        <table className="mt-2 text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pr-4">Permission</th>
              <th className="pr-2">Effective</th>
              <th className="pr-2">Grant</th>
              <th>Revoke</th>
            </tr>
          </thead>
          <tbody>
            {allPerms.map((p) => (
              <tr key={p}>
                <td className="pr-4 font-mono">{p}</td>
                <td>{effective.includes(p) ? "✓" : ""}</td>
                <td>
                  <input type="checkbox" checked={g.includes(p)} onChange={(e) => setG((xs) => (e.target.checked ? [...xs, p] : xs.filter((y) => y !== p)))} aria-label={`Grant ${p}`} />
                </td>
                <td>
                  <input type="checkbox" checked={v.includes(p)} onChange={(e) => setV((xs) => (e.target.checked ? [...xs, p] : xs.filter((y) => y !== p)))} aria-label={`Revoke ${p}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending || !r.length} className={buttonClass("primary", "sm")} onClick={() => run(() => api(`/team/members/${membershipId}`, { method: "PATCH", body: { roles: r, grants: g, revocations: v } }), "Saved.")}>
          Save access
        </button>
        <button disabled={pending} className={buttonClass(status === "ACTIVE" ? "danger" : "secondary", "sm")} onClick={() => run(() => api(`/team/members/${membershipId}`, { method: "PATCH", body: { status: status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" } }))}>
          {status === "ACTIVE" ? "Suspend" : "Reactivate"}
        </button>
        <FormStatus error={error} ok={ok} />
      </div>
    </div>
  );
}

export function OrgSettingsForm({ org, profile, isProvider }: { org: { name: string; timezone: string; documentRetentionDays: number }; profile: { serviceStates: string[]; equipmentTypes: string[]; serviceTypes: string[]; acceptingLoads: boolean } | null; isProvider: boolean }) {
  const { pending, error, ok, run } = useSubmit();
  const [states, setStates] = useState<string[]>(profile?.serviceStates ?? []);
  const [equip, setEquip] = useState<string[]>(profile?.equipmentTypes ?? []);
  const [services, setServices] = useState<string[]>(profile?.serviceTypes ?? []);
  const [accepting, setAccepting] = useState(profile?.acceptingLoads ?? true);
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, x: string) => set((xs) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () =>
            api("/org", {
              method: "PATCH",
              body: { name: f.get("name"), timezone: f.get("timezone"), documentRetentionDays: Number(f.get("retention")), ...(isProvider ? { serviceStates: states, equipmentTypes: equip, serviceTypes: services, acceptingLoads: accepting } : {}) },
            }),
          "Saved.",
        );
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Organization name">
          <input name="name" defaultValue={org.name} className="field" />
        </Field>
        <Field label="Time zone">
          <select name="timezone" defaultValue={org.timezone} className="field">
            {["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <Field label="Document retention (days)" hint="Files older than this are purged by a daily job; records of them remain.">
          <input name="retention" type="number" min={30} max={3650} defaultValue={org.documentRetentionDays} className="field" />
        </Field>
      </div>
      {isProvider && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} /> Accepting new loads
          </label>
          <fieldset>
            <legend className="label">Services</legend>
            <div className="flex flex-wrap gap-1">
              {SERVICE_TYPES.map((x) => (
                <button type="button" key={x} onClick={() => toggle(setServices, x)} className={cx("rounded-full border px-2.5 py-0.5 text-xs", services.includes(x) ? "border-brand-500 bg-brand-50" : "border-slate-300")}>
                  {SERVICE_TYPE_LABEL[x]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Equipment</legend>
            <div className="flex flex-wrap gap-1">
              {EQUIPMENT_TYPES.map((x) => (
                <button type="button" key={x} onClick={() => toggle(setEquip, x)} className={cx("rounded-full border px-2.5 py-0.5 text-xs", equip.includes(x) ? "border-brand-500 bg-brand-50" : "border-slate-300")}>
                  {EQUIPMENT_LABEL[x]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Service area ({states.length} states)</legend>
            <div className="flex flex-wrap gap-1">
              {US_STATES.map((x) => (
                <button type="button" key={x} onClick={() => toggle(setStates, x)} className={cx("w-10 rounded border py-0.5 text-xs", states.includes(x) ? "border-brand-500 bg-brand-50" : "border-slate-300")}>
                  {x}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}
      <FormStatus error={error} ok={ok} />
      <Submit pending={pending}>Save settings</Submit>
    </form>
  );
}

export function NotificationPrefs({ prefs }: { prefs: { eventType: string; inApp: boolean; email: boolean }[] }) {
  const { pending, error, ok, run } = useSubmit();
  const [rows, setRows] = useState(prefs);
  return (
    <div className="space-y-3">
      <Notice tone="amber">Email delivery is not connected. Email notifications are written to an outbox that platform administrators can review.</Notice>
      <table className="text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="pr-6">Event</th>
            <th className="pr-4">In app</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.eventType}>
              <td className="py-0.5 pr-6">{p.eventType.replaceAll("_", " ").toLowerCase()}</td>
              <td>
                <input type="checkbox" checked={p.inApp} onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, inApp: e.target.checked } : x)))} aria-label={`${p.eventType} in app`} />
              </td>
              <td>
                <input type="checkbox" checked={p.email} onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, email: e.target.checked } : x)))} aria-label={`${p.eventType} email`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <FormStatus error={error} ok={ok} />
      <button disabled={pending} className={buttonClass("primary")} onClick={() => run(() => api("/notifications/preferences", { method: "PUT", body: { preferences: rows } }), "Saved.")}>
        Save preferences
      </button>
    </div>
  );
}
