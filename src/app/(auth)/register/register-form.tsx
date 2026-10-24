"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORG_TYPES, ORG_TYPE_LABEL, US_STATES, type OrgType } from "@/lib/domain";
import { api } from "@/lib/client/api";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

export function RegisterForm() {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  const [type, setType] = useState<OrgType>("SHIPPER");
  const motor = type === "CARRIER" || type === "AUTO_TRANSPORT" || type === "FREIGHT_BROKER";
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => (f.get(k) as string)?.trim() || null;
        run(
          () =>
            api("/auth/register", {
              body: {
                name: s("name"),
                email: s("email"),
                password: f.get("password"),
                organization: { name: s("orgName"), type, city: s("city"), state: s("state"), usdotNumber: s("usdot"), mcNumber: s("mc") },
              },
            }),
          undefined,
          () => router.push("/command"),
        );
      }}
    >
      <Field label="Your name">
        <input name="name" required className="field" autoComplete="name" />
      </Field>
      <Field label="Work email">
        <input name="email" type="email" required className="field" autoComplete="email" />
      </Field>
      <Field label="Password" hint="At least 12 characters.">
        <input name="password" type="password" minLength={12} required className="field" autoComplete="new-password" />
      </Field>
      <hr className="border-slate-100" />
      <Field label="Organization name">
        <input name="orgName" required className="field" autoComplete="organization" />
      </Field>
      <Field label="Organization type">
        <select className="field" value={type} onChange={(e) => setType(e.target.value as OrgType)}>
          {ORG_TYPES.map((t) => (
            <option key={t} value={t}>
              {ORG_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City">
          <input name="city" className="field" />
        </Field>
        <Field label="State">
          <select name="state" className="field" defaultValue="">
            <option value="">—</option>
            {US_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {motor && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="USDOT number" hint="Self-reported until verified.">
            <input name="usdot" inputMode="numeric" className="field" />
          </Field>
          <Field label="MC number">
            <input name="mc" className="field" />
          </Field>
        </div>
      )}
      <FormStatus error={error} />
      <Submit pending={pending}>Create organization</Submit>
    </form>
  );
}
