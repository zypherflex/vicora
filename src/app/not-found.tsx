import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">This page does not exist, or you do not have access to it.</p>
      <Link href="/command" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
        Back to the command center
      </Link>
    </main>
  );
}
