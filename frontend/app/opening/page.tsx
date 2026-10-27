"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { getOpening, setApplied, type OpeningDetail } from "@/lib/api";
import { deadlineBadge, formatDate } from "@/lib/format";
import { Pill } from "@/components/OpeningCard";
import { useToast } from "@/components/Toast";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="col-span-2">{children}</dd>
    </div>
  );
}

function OpeningView() {
  const id = useSearchParams().get("id");
  const toast = useToast();
  const [o, setO] = useState<OpeningDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return setError("No opening specified");
    getOpening(id).then(setO).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  async function toggle() {
    if (!o) return;
    const next = !o.applied;
    setO({ ...o, applied: next });
    try {
      await setApplied(o.id, next);
    } catch (e) {
      setO({ ...o, applied: !next });
      toast(e instanceof Error ? e.message : "Could not update");
    }
  }

  if (error)
    return (
      <div className="card p-10 text-center">
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <Link href="/" className="btn-ghost mt-4">← Back to dashboard</Link>
      </div>
    );
  if (!o) return <div className="card h-64 animate-pulse bg-slate-100 dark:bg-slate-900" />;

  const badge = deadlineBadge(o.deadline, o.is_expired);
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Back to dashboard</Link>
      <section className="card space-y-4 p-5">
        <div>
          <h1 className="text-xl font-bold">{o.role}</h1>
          <p className="text-slate-600 dark:text-slate-400">{o.company}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.employment_type && <Pill className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{o.employment_type}</Pill>}
          <Pill className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{badge.label}</Pill>
        </div>
        <dl className="divide-y divide-slate-200 dark:divide-slate-800">
          <Row label="Location">{o.location ?? "—"}</Row>
          <Row label="Eligibility">{o.eligibility ?? "—"}</Row>
          <Row label="Deadline">{o.deadline ? formatDate(o.deadline) : "—"}</Row>
          <Row label="Source">{o.source_type} · {o.source_name}</Row>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          {o.apply_link && <a href={o.apply_link} target="_blank" rel="noopener noreferrer" className="btn-primary">Apply ↗</a>}
          {o.source_url && <a href={o.source_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">Open original post ↗</a>}
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={o.applied} onChange={toggle} /> Applied
          </label>
        </div>
      </section>
      <section className="card p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Original post</h2>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{o.raw_text}</pre>
      </section>
    </div>
  );
}

// Static export (GitHub Pages) can't have dynamic routes, so the id is a query param: /opening?id=7
export default function OpeningPage() {
  return (
    <Suspense fallback={null}>
      <OpeningView />
    </Suspense>
  );
}
