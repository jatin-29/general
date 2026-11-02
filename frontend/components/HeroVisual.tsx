"use client";

import { useEffect, useRef } from "react";

/** Three floating job cards in warm paper colours. Follows the pointer a little. */
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
      <div className="par" style={{ left: "17%", top: "8%", width: "66%", ["--d" as string]: 8 }}>
        <div className="stack-card border border-[rgb(var(--border))] bg-[rgb(var(--surface))]" style={{ transform: "rotate(-4deg)", ["--t" as string]: "7s" } as React.CSSProperties}>
          <p className="text-[0.65rem] font-extrabold uppercase tracking-wider text-brand-600">Closing in 3 days</p>
          <p className="font-display text-lg font-bold">Frontend Intern</p>
          <p className="on-bg-muted text-xs">Remote · 2026 batch</p>
        </div>
      </div>
      <div className="par" style={{ left: "10%", top: "36%", width: "74%", ["--d" as string]: 14 }}>
        <div className="stack-card text-white" style={{ background: "linear-gradient(135deg,#d9622b,#b4400f)", transform: "rotate(3deg)", animationDelay: "-2s" }}>
          <p className="text-[0.65rem] font-extrabold uppercase tracking-wider opacity-90">New today</p>
          <p className="font-display text-lg font-bold">Data Analyst</p>
          <p className="text-xs opacity-90">Bengaluru · Full-time</p>
        </div>
      </div>
      <div className="par" style={{ left: "20%", top: "64%", width: "64%", ["--d" as string]: 20 }}>
        <div className="stack-card text-white" style={{ background: "linear-gradient(135deg,#7f8f5c,#5b6b3e)", transform: "rotate(-2deg)", animationDelay: "-4s" }}>
          <p className="text-[0.65rem] font-extrabold uppercase tracking-wider opacity-90">Apply now</p>
          <p className="font-display text-lg font-bold">Backend Engineer</p>
          <p className="text-xs opacity-90">Pune · Referral open</p>
        </div>
      </div>
    </div>
  );
}
