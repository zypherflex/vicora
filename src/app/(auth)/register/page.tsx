import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create organization" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Create your organization</h1>
      <p className="mt-1 text-sm text-slate-500">You become the owner and can invite your team afterwards.</p>
      <RegisterForm />
      <p className="mt-4 text-sm text-slate-500">
        Already have an account? <Link className="text-brand-600 hover:underline" href="/login">Sign in</Link>
      </p>
    </>
  );
}
