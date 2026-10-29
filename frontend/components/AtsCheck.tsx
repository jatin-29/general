"use client";

import { useState } from "react";
import type { CheckGroup, Level } from "@/lib/atsCheck";

const ICON: Record<Level, { mark: string; cls: string }> = {
  pass: { mark: "✓", cls: "bg-emerald-500" },
  warn: { mark: "!", cls: "bg-amber-500" },
  fail: { mark: "✕", cls: "bg-rose-500" },
};

/** Score plus checklist of how readable the resume is for applicant tracking systems. */
export default function AtsCheck({ score, groups }: { score: number; groups: CheckGroup[] }) {
  const [all, setAll] = useState(false);
  const color = score >= 85 ? "#10b981" : score >= 65 ? "#f59e0b" : "#f43f5e";
  const issues = groups.flatMap((g) => g.items).filter((i) => i.level !== "pass").length;
  return (
    <div className="card space-y-3 p-4" aria-label="ATS check">
      <div className="flex items-center gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${score * 3.6}deg, rgb(148 163 184 / .25) 0)` }}>
          <div className="font-display grid h-12 w-12 place-items-center rounded-full bg-[rgb(var(--surface))] text-lg font-black" style={{ color }} data-testid="ats-score">{score}</div>
        </div>
        <div className="min-w-0">
          <h2 className="font-display font-black">ATS check</h2>
          <p className="text-xs text-slate-500">{issues ? `${issues} thing${issues === 1 ? "" : "s"} to improve` : "Ready for applicant tracking systems"}. Read back the way an ATS reads your PDF.</p>
        </div>
      </div>
      {groups.map((g) => {
        const items = all ? g.items : g.items.filter((i) => i.level !== "pass");
        const passed = g.items.length - g.items.filter((i) => i.level !== "pass").length;
        return (
          <div key={g.title}>
            <h3 className="mb-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">{g.title} · {passed}/{g.items.length} ✓</h3>
            <ul className="space-y-1.5">
              {items.map((i, n) => (
                <li key={n} className="flex gap-2 text-sm">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-black text-white ${ICON[i.level].cls}`} aria-label={i.level}>{ICON[i.level].mark}</span>
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{i.label}</span>
                    {i.hint && <span className="block text-xs text-slate-500">{i.hint}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <button className="text-xs font-bold text-violet-600 underline dark:text-violet-300" onClick={() => setAll(!all)}>{all ? "Show only what to fix" : "Show every check"}</button>
    </div>
  );
}
