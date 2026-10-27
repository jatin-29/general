"use client";

import { useEffect, useRef } from "react";

const CANDY = ["#38bdf8", "#f43f5e", "#a855f7", "#fbbf24", "#ec4899", "#22c55e"];
// [left%, top%, size(px), colour, depth, float seconds, delay]
const ORBS: [number, number, number, number, number, number, number][] = [
  [4, 8, 46, 0, 22, 7, 0], [84, 2, 40, 3, 30, 8, -2], [92, 30, 36, 4, 18, 6.5, -1], [-2, 46, 30, 2, 26, 9, -4],
  [88, 62, 52, 2, 20, 7.5, -3], [8, 78, 38, 5, 28, 8.5, -5], [70, 88, 42, 3, 16, 6, -2], [46, -3, 24, 1, 34, 7, -6],
];
const SPRINKLES: [number, number, number, number][] = [
  [20, 22, 1, 40], [78, 14, 5, -30], [14, 62, 2, -50], [92, 48, 0, 35], [60, 94, 4, 60], [36, 6, 3, 20],
];

/** Decorative job-card "scoops" with floating candy shapes. Follows the pointer a little. */
export default function HeroVisual() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches) return;
    const move = (e: PointerEvent) => {
      el.style.setProperty("--mx", String((e.clientX / innerWidth - 0.5) * 2));
      el.style.setProperty("--my", String((e.clientY / innerHeight - 0.5) * 2));
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <div ref={ref} className="hero-visual" aria-hidden="true">
      {SPRINKLES.map(([l, t, c, r], i) => (
        <span key={`s${i}`} className="par" style={{ left: `${l}%`, top: `${t}%`, ["--d" as string]: 14 + i * 3 }}>
          <i className="sprinkle" style={{ ["--c" as string]: CANDY[c], ["--r" as string]: `${r}deg`, ["--t" as string]: `${7 + i}s`, ["--dl" as string]: `${-i}s` }} />
        </span>
      ))}

      <div className="par" style={{ left: "17%", top: "6%", width: "66%", ["--d" as string]: 8 }}>
        <div className="stack-card bg-white" style={{ transform: "rotate(-4deg)", ["--t" as string]: "7s" } as React.CSSProperties}>
          <p className="text-[0.65rem] font-extrabold uppercase tracking-wider text-fuchsia-500">Closing in 3 days</p>
          <p className="font-display text-lg font-black text-slate-800">Frontend Intern</p>
          <p className="text-xs text-slate-500">Remote · 2026 batch</p>
        </div>
      </div>
      <div className="par" style={{ left: "10%", top: "34%", width: "74%", ["--d" as string]: 14 }}>
        <div className="stack-card text-white" style={{ background: "linear-gradient(135deg,#f472b6,#fb7185)", transform: "rotate(3deg)", animationDelay: "-2s" }}>
          <p className="text-[0.65rem] font-extrabold uppercase tracking-wider opacity-90">New today</p>
          <p className="font-display text-lg font-black">Data Analyst</p>
          <p className="text-xs opacity-90">Bengaluru · Full-time</p>
        </div>
      </div>
      <div className="par" style={{ left: "20%", top: "62%", width: "64%", ["--d" as string]: 20 }}>
        <div className="stack-card text-white" style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)", transform: "rotate(-2deg)", animationDelay: "-4s" }}>
          <p className="text-[0.65rem] font-extrabold uppercase tracking-wider opacity-90">Apply now</p>
          <p className="font-display text-lg font-black">Backend Engineer</p>
          <p className="text-xs opacity-90">Pune · Referral open</p>
        </div>
      </div>

      {ORBS.map(([l, t, s, c, d, ft, dl], i) => (
        <span key={`o${i}`} className="par" style={{ left: `${l}%`, top: `${t}%`, ["--d" as string]: d }}>
          <i className="orb" style={{ width: s, height: s * 0.86, ["--c" as string]: CANDY[c], ["--t" as string]: `${ft}s`, ["--dl" as string]: `${dl}s` }} />
        </span>
      ))}
    </div>
  );
}
