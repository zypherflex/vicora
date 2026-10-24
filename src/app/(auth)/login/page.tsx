import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAuth } from "@/server/http/api";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const sp = await searchParams;
  const auth = await currentAuth();
  if (auth?.active && sp.reason !== "no-org") redirect("/command");
  const next = sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/command";
  return (
    <>
      <h1 className="text-lg font-semibold">Sign in</h1>
      {sp.reason === "no-org" && <p className="mt-2 text-sm text-amber-700">Your account has no active organization membership.</p>}
      <LoginForm next={next} />
      <p className="mt-4 text-sm text-slate-500">
        New to Vicora? <Link className="text-brand-600 hover:underline" href="/register">Create an organization</Link>
      </p>
      <details className="mt-6 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium">Demo accounts (after running the seed)</summary>
        <p className="mt-2">Password for all: <code>VicoraDemo!2026</code></p>
        <ul className="mt-1 space-y-0.5">
          <li><code>maya@lakeshore.demo</code> shipper owner</li>
          <li><code>kim@pacificcrest.demo</code> auto shipper</li>
          <li><code>dana@meridian.demo</code> freight broker</li>
          <li><code>ruth@harborline.demo</code> licensed customs broker</li>
          <li><code>ops@ironwood.demo</code> carrier fleet manager</li>
          <li><code>carlos@ironwood.demo</code> truck driver</li>
          <li><code>jay@redline.demo</code> / <code>tasha@redline.demo</code> auto transport</li>
          <li><code>admin@vicora.demo</code> platform admin</li>
        </ul>
      </details>
    </>
  );
}
