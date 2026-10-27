"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createOpening, extractPost, type EmploymentType, type NewOpening } from "@/lib/api";
import { useToast } from "@/components/Toast";

const EMPTY: NewOpening = { company: "", role: "", location: "", employment_type: "", eligibility: "", deadline: "", apply_link: "", notes: "" };

export default function AddOpeningPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<NewOpening>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<NewOpening>) => setForm((f) => ({ ...f, ...patch }));

  async function autofill() {
    const text = form.notes?.trim();
    if (!text) return;
    setBusy(true);
    try {
      const x = await extractPost(text);
      if (!x.is_opening) toast("That doesn't look like a job posting. Fill the form yourself.");
      set({
        company: x.company ?? form.company,
        role: x.role ?? form.role,
        location: x.location ?? form.location,
        employment_type: (x.employment_type ?? form.employment_type) as EmploymentType | "",
        eligibility: x.eligibility ?? form.eligibility,
        deadline: x.deadline ?? form.deadline,
        apply_link: x.apply_link ?? form.apply_link,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Auto-fill failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createOpening(form);
      toast("Opening added", "success");
      router.push("/?source=manual");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add");
      setBusy(false);
    }
  }

  const label = "block space-y-1 text-sm font-medium";
  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Add an opening</h1>
        <p className="mt-1 text-sm text-slate-500">For anything you find yourself (a WhatsApp group, a friend, a website). Paste the post and let AI fill the form, or type it in.</p>
      </div>

      <section className="card space-y-3 p-5">
        <label className={label}>
          Original post (optional)
          <textarea className="input min-h-32 font-normal" placeholder="Paste the message here…" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <button type="button" className="btn-ghost" disabled={busy || !form.notes?.trim()} onClick={autofill}>
          ✨ Auto-fill from this post
        </button>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <label className={label}>Company *<input className="input font-normal" required value={form.company} onChange={(e) => set({ company: e.target.value })} /></label>
        <label className={label}>Role *<input className="input font-normal" required value={form.role} onChange={(e) => set({ role: e.target.value })} /></label>
        <label className={label}>Location<input className="input font-normal" value={form.location} onChange={(e) => set({ location: e.target.value })} /></label>
        <label className={label}>
          Type
          <select className="input font-normal" value={form.employment_type} onChange={(e) => set({ employment_type: e.target.value as EmploymentType | "" })}>
            <option value="">Not specified</option>
            <option value="internship">Internship</option>
            <option value="full-time">Full-time</option>
            <option value="contract">Contract</option>
          </select>
        </label>
        <label className={label}>Deadline<input className="input font-normal" type="date" value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} /></label>
        <label className={label}>Apply link<input className="input font-normal" type="url" placeholder="https://…" value={form.apply_link} onChange={(e) => set({ apply_link: e.target.value })} /></label>
        <label className={`${label} sm:col-span-2`}>Eligibility<input className="input font-normal" placeholder="e.g. 2026 batch, BE/BTech" value={form.eligibility} onChange={(e) => set({ eligibility: e.target.value })} /></label>
      </section>

      <button className="btn-primary" disabled={busy || !form.company.trim() || !form.role.trim()}>Add opening</button>
    </form>
  );
}
