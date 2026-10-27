"use client";

import { useEffect, useRef, useState } from "react";
import { getToken, setToken } from "@/lib/remote";

/** Asks once per device for the GitHub key that lets the site delete jobs for good. */
export default function TokenDialog({ onClose, onSaved, reason }: { onClose: () => void; onSaved: () => void; reason?: string }) {
  const [value, setValue] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHasKey(!!getToken());
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-label="GitHub key"
        className="card w-full max-w-md animate-[pop-in_.3s_both] space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          setToken(value);
          onSaved();
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-black">🔑 GitHub key</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500">✕</button>
        </div>
        {reason && <p className="text-sm font-semibold text-rose-600">{reason}</p>}
        <p className="text-sm text-slate-600 dark:text-slate-300">
          To delete jobs for good, paste the <b>same GitHub token you made for cron-job.org</b> (Actions: Read and write, only the{" "}
          <code>general</code> repo). It is saved only in this browser and can only start the collector.
        </p>
        <input ref={input} className="input font-mono" type="password" autoComplete="off" placeholder="github_pat_…" aria-label="GitHub token" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!value.trim()}>Save key</button>
          {hasKey && (
            <button type="button" className="btn-ghost text-rose-600" onClick={() => { setToken(""); onClose(); }}>
              Remove saved key
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
