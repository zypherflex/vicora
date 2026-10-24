"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">The error was logged{error.digest ? ` (reference ${error.digest})` : ""}. Try again, or reload the page.</p>
      <button onClick={reset} className="mt-4 rounded-md bg-brand-600 px-3 py-2 text-sm text-white">
        Try again
      </button>
    </div>
  );
}
