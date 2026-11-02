"use client";

import { useEffect, useState } from "react";
import { dayKey, dayLabel, monthStart } from "@/lib/days";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

/** Month view with how many jobs came in each day; pick a day to see only its jobs. */
export default function JobCalendar({ counts, value, onChange }: { counts: Record<string, number>; value: string; onChange: (day: string) => void }) {
  const latest = Object.keys(counts).sort().pop();
  const [month, setMonth] = useState(() => monthStart(value || latest || dayKey(new Date())));
  const [open, setOpen] = useState(false); // phones: folded until you ask for it
  useEffect(() => {
    if (value) setMonth(monthStart(value));
  }, [value]);

  const y = month.getFullYear();
  const m = month.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const today = dayKey(new Date());
  const inMonth = Object.entries(counts).filter(([k]) => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).reduce((s, [, n]) => s + n, 0);
  const go = (delta: number) => setMonth(new Date(y, m + delta, 1));

  return (
    <div className="card p-3">
      <button className="flex w-full items-center justify-between gap-2 px-1 py-1 text-sm font-bold lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>📅 {value ? `${dayLabel(value)} · ${counts[value] ?? 0} jobs` : "Pick a date"}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      <div className={`${open ? "block" : "hidden"} lg:block`}>
        <div className="mb-2 flex items-center justify-between gap-2 px-1 pt-1">
          <button className="grid h-8 w-8 place-items-center rounded-full font-black hover:bg-slate-500/15" onClick={() => go(-1)} aria-label="Previous month">‹</button>
          <div className="text-center">
            <div className="font-display font-black">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
            <div className="text-[11px] font-semibold text-slate-500">{inMonth} job{inMonth === 1 ? "" : "s"} this month</div>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-full font-black hover:bg-slate-500/15" onClick={() => go(1)} aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Jobs per day">
          {WEEK.map((d, i) => <div key={i} className="pb-1 text-[11px] font-extrabold text-slate-500">{d}</div>)}
          {Array.from({ length: new Date(y, m, 1).getDay() }, (_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const k = dayKey(new Date(y, m, i + 1));
            const n = counts[k] ?? 0;
            const on = value === k;
            return (
              <button
                key={k}
                disabled={!n}
                onClick={() => onChange(on ? "" : k)}
                aria-pressed={on}
                aria-label={`${dayLabel(k)}: ${n} job${n === 1 ? "" : "s"}`}
                className={`flex h-11 flex-col items-center justify-center rounded-xl text-sm leading-none transition ${
                  on ? "bg-[rgb(var(--accent-dark))] font-black text-white shadow-md" : n ? "font-bold hover:bg-[rgb(var(--accent)/0.18)]" : "text-slate-400 opacity-60"
                } ${k === today && !on ? "ring-2 ring-[rgb(var(--accent))]" : ""}`}
              >
                {i + 1}
                {n > 0 && <span className={`mt-1 rounded-full px-1.5 text-[10px] font-extrabold ${on ? "bg-white/25" : "bg-[rgb(var(--accent)/0.22)]"}`}>{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs font-semibold text-slate-500">
          <span>{value ? `${dayLabel(value)}: ${counts[value] ?? 0} jobs` : "Tap a day to see its jobs"}</span>
          {value && <button className="font-bold text-[rgb(var(--accent-dark))] underline" onClick={() => onChange("")}>All dates</button>}
        </div>
      </div>
    </div>
  );
}
