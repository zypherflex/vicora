"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Field, FormStatus, Submit, useSubmit } from "@/components/ui/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => api("/auth/login", { body: { email: f.get("email"), password: f.get("password") } }), undefined, () => router.push(next === "/command" ? "/" : next));
      }}
    >
      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required className="field" />
      </Field>
      <Field label="Password">
        <input name="password" type="password" autoComplete="current-password" required className="field" />
      </Field>
      <FormStatus error={error} />
      <Submit pending={pending}>Sign in</Submit>
    </form>
  );
}
