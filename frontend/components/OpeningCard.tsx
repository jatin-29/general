"use client";

import Link from "next/link";
import type { Opening } from "@/lib/api";
import { deadlineBadge, formatDate, type Urgency } from "@/lib/format";

const URGENCY: Record<Urgency, string> = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  none: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  expired: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

const SOURCE: Record<string, string> = {
  telegram: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  youtube: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  manual: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

export const Pill = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>
);

export default function OpeningCard({
  opening: o,
  onToggleApplied,
}: {
  opening: Opening;
  onToggleApplied: (o: Opening) => void;
}) {
  const badge = deadlineBadge(o.deadline, o.is_expired);
  return (
    <article className={`card flex flex-col gap-3 p-4 transition sm:flex-row sm:items-center ${o.applied || o.is_expired ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Pill className={SOURCE[o.source_type] ?? SOURCE.telegram}>
            {o.source_type} · {o.source_name}
          </Pill>
          {o.employment_type && (
            <Pill className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{o.employment_type}</Pill>
          )}
          <Pill className={URGENCY[badge.urgency]}>{badge.label}</Pill>
        </div>
        <Link href={`/opening?id=${o.id}`} className="block truncate text-base font-semibold hover:text-indigo-600 dark:hover:text-indigo-400">
          {o.role}
        </Link>
        <p className="truncate text-sm text-slate-600 dark:text-slate-400">
          {o.company}
          {o.location && <> · {o.location}</>}
          {o.deadline && <> · Deadline {formatDate(o.deadline)}</>}
        </p>
        {o.eligibility && <p className="mt-1 line-clamp-1 text-xs text-slate-500">{o.eligibility}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={o.applied}
            onChange={() => onToggleApplied(o)}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
          />
          Applied
        </label>
        {o.apply_link ? (
          <a href={o.apply_link} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Apply ↗
          </a>
        ) : (
          <Link href={`/opening?id=${o.id}`} className="btn-ghost">
            View post
          </Link>
        )}
      </div>
    </article>
  );
}
