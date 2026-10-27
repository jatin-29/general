"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { JOBS_MODE } from "@/lib/mode";
import ThemeToggle from "./ThemeToggle";

const fire = (name: string) => window.dispatchEvent(new Event(name));

/** Hamburger menu. The feed and the Spotify widget listen for these events. */
export default function MenuButton() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const item = "block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-violet-500/10";
  const act = (name: string) => () => {
    setOpen(false);
    fire(name);
  };

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open} className="group grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/20">
        <span className="flex w-6 flex-col gap-[5px]" aria-hidden="true">
          <i className={`h-[3px] rounded-full bg-white transition-all duration-300 ${open ? "translate-y-[8px] rotate-45" : "w-full"}`} />
          <i className={`h-[3px] rounded-full bg-white transition-all duration-300 ${open ? "opacity-0" : "w-4/5 group-hover:w-full"}`} />
          <i className={`h-[3px] rounded-full bg-white transition-all duration-300 ${open ? "-translate-y-[8px] -rotate-45" : "w-3/5 group-hover:w-full"}`} />
        </span>
      </button>
      {open && (
        <nav className="card absolute left-0 top-14 z-50 w-60 animate-[pop-in_.25s_both] space-y-0.5 p-2">
          {!JOBS_MODE && (
            <>
              <Link href="/" className={item} onClick={() => setOpen(false)}>Dashboard</Link>
              <Link href="/add" className={item} onClick={() => setOpen(false)}>Add</Link>
              <Link href="/sources" className={item} onClick={() => setOpen(false)}>Sources</Link>
              <Link href="/settings" className={item} onClick={() => setOpen(false)}>Settings</Link>
            </>
          )}
          {JOBS_MODE && <button className={item} onClick={act("openings:add")}>＋ Add a job</button>}
          <button className={item} onClick={act("openings:spotify")}>♫ Spotify</button>
          <div className="flex items-center justify-between rounded-xl px-3 py-1.5 text-sm font-semibold">
            Dark mode <ThemeToggle />
          </div>
          {JOBS_MODE && <button className={`${item} text-rose-600`} onClick={act("openings:lock")}>🔒 Lock</button>}
        </nav>
      )}
    </div>
  );
}
