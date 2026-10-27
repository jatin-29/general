"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Job } from "@/lib/jobs";
import { isProfileStarted, loadProfile, type Profile } from "@/lib/profile";
import {
  DEFAULT_TEMPLATES, fill, findEmails, gmailUrl, linkedinPeople, loadTemplates, mailtoUrl, values, whatsappUrl,
  type Kind, type Templates, type Tone,
} from "@/lib/templates";
import { STATUSES, withStatus, type Status, type Track } from "@/lib/tracker";
import { useToast } from "./Toast";

type Tab = Kind | "track";
const TABS: { id: Tab; label: string }[] = [
  { id: "email", label: "✉️ Email HR" },
  { id: "referral", label: "🤝 Referral" },
  { id: "followup", label: "🔁 Follow-up" },
  { id: "track", label: "📝 Track" },
];
const RANK: Status[] = ["", "saved", "applied", "referral", "interview", "offer", "rejected"];
const label = "block space-y-1 text-sm font-semibold";

/** Everything needed to apply for one job: ready messages from your profile, LinkedIn searches, and tracking. */
export default function ApplyKit({ job, company: c0, role: r0, track, onTrack, onClose }: {
  job: Job; company: string | null; role: string | null; track?: Track; onTrack: (t: Track) => void; onClose: () => void;
}) {
  const toast = useToast();
  const emails = useMemo(() => findEmails(job.text), [job.text]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [templates, setTemplates] = useState<Templates>(DEFAULT_TEMPLATES);
  const [tab, setTab] = useState<Tab>(emails.length ? "email" : "referral");
  const [tone, setTone] = useState<Tone>("formal");
  const [company, setCompany] = useState(c0 ?? "");
  const [role, setRole] = useState(r0 ?? "");
  const [contact, setContact] = useState("");
  const [to, setTo] = useState(emails[0] ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    setProfile(loadProfile());
    setTemplates(loadTemplates());
    try {
      const t = localStorage.getItem("kit_tone") as Tone | null;
      if (t) setTone(t);
    } catch {}
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // (re)write the message whenever the choices change; your edits stay until you change a choice
  useEffect(() => {
    if (!profile || tab === "track") return;
    const v = values(profile, { company, role, contact, appliedOn: track?.appliedOn ?? "" });
    const t = templates[tab][tone];
    setSubject(fill(t.subject, v));
    setBody(fill(t.body, v));
  }, [profile, templates, tab, tone, contact, company, role, track?.appliedOn]);

  const pickTone = (t: Tone) => {
    setTone(t);
    try {
      localStorage.setItem("kit_tone", t);
    } catch {}
  };
  const promote = (s: Status) => {
    if (RANK.indexOf(track?.status ?? "") < RANK.indexOf(s)) {
      onTrack(withStatus(track, s));
      toast(`Marked as "${STATUSES.find((x) => x.value === s)?.label}". Change it any time in Track.`, "success");
    }
  };
  const copy = async (text: string, then?: Status) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied", "success");
      if (then) promote(then);
    } catch {
      toast("Could not copy. Select the text and copy it yourself.");
    }
  };
  const setTrack = (patch: Partial<Track>) => onTrack({ ...withStatus(track, track?.status ?? ""), ...patch, updated: Date.now() });

  const college = profile?.college ?? "";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Apply kit" className="card max-h-[92vh] w-full max-w-2xl animate-[pop-in_.3s_both] overflow-y-auto p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Apply kit</p>
            <h2 className="font-display truncate text-xl font-black">{role || "This job"}{company ? ` · ${company}` : ""}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-xl text-slate-500">✕</button>
        </div>

        {profile && !isProfileStarted(profile) && (
          <p className="mb-3 rounded-2xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Fill in <Link href="/profile" className="font-bold underline">your profile</Link> once, and every message will include your name, college, skills and links.
          </p>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition ${tab === t.id ? "bg-indigo-600 text-white shadow" : "bg-slate-500/10 hover:bg-slate-500/20"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "track" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Status
              <select className="input font-normal" value={track?.status ?? ""} onChange={(e) => onTrack(withStatus(track, e.target.value as Status))}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className={label}>Applied on
              <input type="date" className="input font-normal" value={track?.appliedOn ?? ""} onChange={(e) => setTrack({ appliedOn: e.target.value })} />
            </label>
            <label className={label}>Follow up on
              <input type="date" className="input font-normal" value={track?.followUp ?? ""} onChange={(e) => setTrack({ followUp: e.target.value })} />
            </label>
            <label className={`${label} sm:col-span-2`}>Notes
              <textarea className="input min-h-28 font-normal" placeholder="Who referred you, interview dates, salary, anything…" value={track?.note ?? ""} onChange={(e) => setTrack({ note: e.target.value })} />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={label}>Company<input className="input font-normal" value={company} onChange={(e) => setCompany(e.target.value)} /></label>
              <label className={label}>Role<input className="input font-normal" value={role} onChange={(e) => setRole(e.target.value)} /></label>
              <label className={label}>Tone
                <select className="input font-normal" value={tone} onChange={(e) => pickTone(e.target.value as Tone)}>
                  <option value="formal">Formal</option><option value="friendly">Friendly</option><option value="short">Short</option>
                </select>
              </label>
            </div>

            {tab !== "email" && (
              <label className={label}>{tab === "referral" ? "Person's first name (optional)" : "HR person's name (optional)"}
                <input className="input font-normal" placeholder="e.g. Priya" value={contact} onChange={(e) => setContact(e.target.value)} />
              </label>
            )}
            {tab !== "referral" && (
              <label className={label}>To
                <input className="input font-normal" type="email" placeholder="hr@company.com" value={to} onChange={(e) => setTo(e.target.value)} />
                {emails.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5 pt-1 text-xs font-normal">
                    Found in the post:{" "}
                    {emails.map((em) => <button type="button" key={em} onClick={() => setTo(em)} className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{em}</button>)}
                  </span>
                ) : (
                  <span className="block text-xs font-normal text-slate-500">No email address in this post. Use the Apply link, or find HR on LinkedIn (Referral tab).</span>
                )}
              </label>
            )}
            {tab !== "referral" && (
              <label className={label}>Subject<input className="input font-normal" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            )}
            <label className={label}>Message
              <textarea className="input min-h-56 font-normal leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
            </label>

            <div className="flex flex-wrap gap-2">
              {tab === "referral" ? (
                <>
                  <button className="btn-primary" onClick={() => copy(body, "referral")}>📋 Copy message</button>
                  <a className="btn-ghost" href={whatsappUrl(body)} target="_blank" rel="noopener noreferrer" onClick={() => promote("referral")}>WhatsApp</a>
                </>
              ) : (
                <>
                  <a className="btn-primary" href={gmailUrl(to, subject, body)} target="_blank" rel="noopener noreferrer" onClick={() => tab === "email" && promote("applied")}>Open in Gmail</a>
                  <a className="btn-ghost" href={mailtoUrl(to, subject, body)} onClick={() => tab === "email" && promote("applied")}>Mail app</a>
                  <button className="btn-ghost" onClick={() => copy(`Subject: ${subject}\n\n${body}`)}>📋 Copy</button>
                </>
              )}
            </div>

            {tab === "referral" ? (
              <div className="rounded-2xl bg-sky-500/10 p-3 text-sm">
                <p className="mb-2 font-bold">Find someone to ask on LinkedIn</p>
                <div className="flex flex-wrap gap-2">
                  {college && <a className="btn-ghost" href={linkedinPeople(`${company} ${college}`)} target="_blank" rel="noopener noreferrer">🎓 Alumni from {college.split(" ").slice(0, 3).join(" ")}</a>}
                  <a className="btn-ghost" href={linkedinPeople(`${company} recruiter`)} target="_blank" rel="noopener noreferrer">🔎 Recruiters</a>
                  <a className="btn-ghost" href={linkedinPeople(`${company} talent acquisition`)} target="_blank" rel="noopener noreferrer">👥 HR / Talent</a>
                  <a className="btn-ghost" href={linkedinPeople(`${company} ${role}`)} target="_blank" rel="noopener noreferrer">💼 People in this role</a>
                </div>
                <p className="mt-2 text-xs text-slate-500">Alumni from your college reply most often. Send a connection request with a short note, then the message.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Gmail can&apos;t attach files from a link: attach your resume PDF before you press Send.</p>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-500/15 pt-3 text-sm">
          <Link href={`/resume?job=${job.id}`} className="font-bold text-indigo-600 hover:underline dark:text-indigo-400">📄 Tailor my resume for this job →</Link>
          <Link href="/profile" className="text-slate-500 hover:underline">Edit profile &amp; templates</Link>
        </div>
      </div>
    </div>
  );
}
