"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

export function AcceptInvite({ token, hasAccount, signedInAs, invitedEmail }: { token: string; hasAccount: boolean; signedInAs: string | null; invitedEmail: string }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  if (hasAccount && signedInAs !== invitedEmail) {
    return (
      <p className="mt-4 text-sm text-slate-600">
        You already have a Vicora account. <Link className="text-brand-600 hover:underline" href={`/login?next=/invite/${token}`}>Sign in as {invitedEmail}</Link> to accept.
      </p>
    );
  }
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api(`/invitations/${encodeURIComponent(token)}`, { body: hasAccount ? {} : { name: f.get("name"), password: f.get("password") } }), undefined, () => router.push("/command"));
      }}
    >
      {!hasAccount && (
        <>
          <Field label="Your name">
            <input name="name" required className="field" />
          </Field>
          <Field label="Choose a password" hint="At least 12 characters.">
            <input name="password" type="password" minLength={12} required className="field" autoComplete="new-password" />
          </Field>
        </>
      )}
      <FormStatus error={error} />
      <Submit pending={pending}>Accept invitation</Submit>
    </form>
  );
}
