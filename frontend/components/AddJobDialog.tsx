"use client";

import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/jobs";

/** Add a job or company by hand. Saved in this browser only. */
export default function AddJobDialog({ onClose, onSave }: { onClose: () => void; onSave: (job: Job) => void }) {
  const [f, setF] = useState({ company: "", role: "", deadline: "", apply_link: "", notes: "" });
  const first = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));

  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const link = f.apply_link.trim();
    onSave({
      id: "m" + Date.now().toString(36),
      source: "Added by me",
      text: f.notes.trim(),
      apply_link: link || null,
      post_url: null,
      posted_at: null,
      added_at: new Date().toISOString(),
      company: f.company.trim(),
      role: f.role.trim(),
      deadline: f.deadline || null,
      manual: true,
    });
  }

  const label = "block space-y-1 text-sm font-medium";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="card w-full max-w-md space-y-3 p-5" role="dialog" aria-modal="true" aria-label="Add a job">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a job</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">✕</button>
        </div>
        <label className={label}>Company *<input ref={first} required className="input font-normal" value={f.company} onChange={(e) => set({ company: e.target.value })} /></label>
        <label className={label}>Role *<input required className="input font-normal" placeholder="e.g. Software Engineer Intern" value={f.role} onChange={(e) => set({ role: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Deadline<input type="date" className="input font-normal" value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} /></label>
          <label className={label}>Apply link<input type="url" className="input font-normal" placeholder="https://…" value={f.apply_link} onChange={(e) => set({ apply_link: e.target.value })} /></label>
        </div>
        <label className={label}>Notes<textarea className="input min-h-20 font-normal" placeholder="Eligibility, referral contact, anything useful" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        <p className="text-xs text-slate-500">Saved in this browser only, so it won't appear on your other devices.</p>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={!f.company.trim() || !f.role.trim()}>Add</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
