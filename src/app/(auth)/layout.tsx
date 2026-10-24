import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <Link href="/" className="mb-6 text-2xl font-bold tracking-tight text-brand-700">
        Vicora
      </Link>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      <p className="mt-6 max-w-md text-center text-xs text-slate-500">
        Development build. Payments run in sandbox mode, customs filing and carrier verification are not connected to government systems, and seeded organizations are fictional.
      </p>
    </main>
  );
}
