"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { emptyProfile, loadProfile, saveProfile, skillList, type Answer, type Education, type Experience, type Profile, type Project } from "@/lib/profile";
import { DEFAULT_TEMPLATES, loadTemplates, saveTemplates, type Kind, type Templates, type Tone } from "@/lib/templates";
import { loadJSON, saveJSON } from "@/lib/store";
import { useToast } from "@/components/Toast";
import ResumeImport from "@/components/ResumeImport";

const lbl = "block space-y-1 text-sm font-semibold";
const inp = "input font-normal";

function Section({ title, hint, id, children }: { title: string; hint?: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6 space-y-4 p-5">
      <div>
        <h2 className="font-display text-lg font-black">{title}</h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", wide }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; wide?: boolean }) {
  return (
    <label className={`${lbl} ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input className={inp} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Area({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className={`${lbl} sm:col-span-2`}>
      {label}
      <textarea className={`${inp} leading-relaxed`} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className={lbl}>
      {label}
      <select className={inp} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}

/** Install steps, and whether the extension is running in this browser (it marks the page when it is). */
function ExtensionCard() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setVersion(document.documentElement.dataset.ohExtension ?? null);
    read();
    window.addEventListener("openingshub:extension", read);
    const t = setTimeout(read, 1500);
    return () => {
      window.removeEventListener("openingshub:extension", read);
      clearTimeout(t);
    };
  }, []);
  const zip = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/openingshub-autofill.zip`;
  return (
    <>
      {version ? (
        <p className="rounded-2xl bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">✓ Connected (version {version}). Your details on this page go to the extension automatically.</p>
      ) : (
        <p className="rounded-2xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">Not installed in this browser yet.</p>
      )}
      <ol className="list-decimal space-y-1.5 pl-5 text-sm">
        <li><a className="font-bold text-violet-600 underline" href={zip} download>Download the extension</a> and unzip it.</li>
        <li>In Chrome open <code className="rounded bg-slate-500/10 px-1">chrome://extensions</code> and turn on <b>Developer mode</b> (top right).</li>
        <li>Click <b>Load unpacked</b> and pick the unzipped <b>openingshub-autofill</b> folder.</li>
        <li>Pin it (puzzle icon → pin), reload this page, then add your resume PDF in the extension.</li>
      </ol>
      <p className="text-xs text-slate-500">
        On a job form click <b>⚡ Autofill</b> (bottom right on Google Forms, Workday, Greenhouse, Lever…), or the extension icon, or press <b>Alt+Shift+F</b> on any site.
        Filled fields turn green; required ones it couldn&apos;t answer turn yellow. It never submits for you. Works in Chrome, Edge and Brave on a computer (phones don&apos;t support extensions).
        To update: download again, replace the folder, and press ↻ on the extension in chrome://extensions.
      </p>
    </>
  );
}

/** Add / remove / reorder rows of a list (experience, projects, education). */
function ListEditor<T extends object>({ items, onChange, blank, render, addLabel }: {
  items: T[]; onChange: (v: T[]) => void; blank: T; addLabel: string; render: (item: T, set: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-2xl border border-slate-500/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2">{render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}</div>
          <div className="mt-2 flex justify-end gap-1 text-xs">
            <button type="button" className="btn-ghost !px-2.5 !py-1" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button type="button" className="btn-ghost !px-2.5 !py-1" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-rose-600" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => onChange([...items, { ...blank }])}>＋ {addLabel}</button>
    </div>
  );
}

const KINDS: { id: Kind; label: string }[] = [{ id: "email", label: "Email to HR" }, { id: "referral", label: "Referral request" }, { id: "followup", label: "Follow-up" }];
const TONES: Tone[] = ["formal", "friendly", "short"];

export default function ProfilePage() {
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [tpl, setTpl] = useState<Templates>(DEFAULT_TEMPLATES);
  const [kind, setKind] = useState<Kind>("email");
  const [tone, setTone] = useState<Tone>("formal");
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setP(loadProfile());
    setTpl(loadTemplates());
  }, []);
  const loaded = p !== null;
  useEffect(() => {
    if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [loaded]);

  const update = (patch: Partial<Profile>) =>
    setP((prev) => {
      const next = { ...(prev ?? emptyProfile()), ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveProfile(next);
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
      }, 350);
      return next;
    });
  const updateTpl = (field: "subject" | "body", value: string) => {
    const next = { ...tpl, [kind]: { ...tpl[kind], [tone]: { ...tpl[kind][tone], [field]: value } } };
    setTpl(next);
    saveTemplates(next);
  };

  const exportAll = () => {
    const data = { app: "OpeningsHub", version: 1, exported: new Date().toISOString(), profile: p, templates: tpl, tracker: loadJSON("tracker_v1", {}), manual: loadJSON("jobs_manual", []) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `openingshub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importAll = async (f: File | undefined) => {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "OpeningsHub") throw new Error();
      if (!confirm("Replace the profile, templates and tracker on this device with the backup?")) return;
      if (d.profile) { saveProfile({ ...emptyProfile(), ...d.profile }); setP({ ...emptyProfile(), ...d.profile }); }
      if (d.templates) { saveTemplates(d.templates); setTpl(loadTemplates()); }
      if (d.tracker) saveJSON("tracker_v1", d.tracker);
      if (d.manual) saveJSON("jobs_manual", d.manual);
      toast("Backup restored", "success");
    } catch {
      toast("That file is not an OpeningsHub backup.");
    }
  };

  if (!p) return <div className="card skeleton h-96" />;
  const skills = skillList(p);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="font-display text-4xl font-black text-white drop-shadow-[0_4px_18px_rgba(90,40,170,.35)]">My profile</h1>
          <p className="text-sm font-semibold text-white/90">Used in your messages and your resume. Saved only in this browser.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold text-white transition ${saved ? "opacity-100" : "opacity-0"}`}>Saved ✓</span>
          <Link href="/resume" className="btn-pill">Build my resume →</Link>
        </div>
      </div>

      <ResumeImport profile={p} onApply={update} />

      <Section title="About you">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" value={p.name} onChange={(v) => update({ name: v })} />
          <Field label="Headline" value={p.headline} onChange={(v) => update({ headline: v })} placeholder="Final-year B.Tech CSE student" />
          <Field label="Email" type="email" value={p.email} onChange={(v) => update({ email: v })} />
          <Field label="Phone" type="tel" value={p.phone} onChange={(v) => update({ phone: v })} />
          <Field label="City" value={p.location} onChange={(v) => update({ location: v })} placeholder="Delhi, India" />
          <Area label="Short summary (optional, for the resume)" value={p.summary} onChange={(v) => update({ summary: v })} placeholder="2-3 lines about what you do and what you're looking for." />
        </div>
      </Section>

      <Section title="College">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="College / university" value={p.college} onChange={(v) => update({ college: v })} wide />
          <Field label="Degree & branch" value={p.degree} onChange={(v) => update({ degree: v })} placeholder="B.Tech in Computer Science" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Batch (grad year)" value={p.batch} onChange={(v) => update({ batch: v })} placeholder="2026" />
            <Field label="CGPA / %" value={p.cgpa} onChange={(v) => update({ cgpa: v })} placeholder="8.4" />
          </div>
        </div>
      </Section>

      <Section title="Skills" hint="Separate with commas. Put your strongest first; the first few go into your messages.">
        <Area label="Skills" value={p.skills} onChange={(v) => update({ skills: v })} placeholder="Python, Java, React, SQL, DSA, Git" rows={2} />
        {skills.length > 0 && <div className="flex flex-wrap gap-1.5">{skills.map((s) => <span key={s} className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{s}</span>)}</div>}
      </Section>

      <Section title="Links" hint="For the resume link use a Google Drive / OneDrive PDF set to 'Anyone with the link can view'.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="LinkedIn" value={p.linkedin} onChange={(v) => update({ linkedin: v })} placeholder="linkedin.com/in/your-name" />
          <Field label="GitHub" value={p.github} onChange={(v) => update({ github: v })} placeholder="github.com/your-name" />
          <Field label="Portfolio" value={p.portfolio} onChange={(v) => update({ portfolio: v })} />
          <Field label="Resume link (PDF)" value={p.resumeLink} onChange={(v) => update({ resumeLink: v })} placeholder="https://drive.google.com/…" />
        </div>
      </Section>

      <Section title="Experience" hint="Internships, part-time jobs, freelancing. One achievement per line, start with a verb and add numbers.">
        <ListEditor<Experience>
          items={p.experience} onChange={(v) => update({ experience: v })} addLabel="Add experience"
          blank={{ company: "", role: "", start: "", end: "", location: "", bullets: "" }}
          render={(x, set) => (
            <>
              <Field label="Company" value={x.company} onChange={(v) => set({ company: v })} />
              <Field label="Role" value={x.role} onChange={(v) => set({ role: v })} />
              <Field label="From" value={x.start} onChange={(v) => set({ start: v })} placeholder="May 2025" />
              <Field label="To" value={x.end} onChange={(v) => set({ end: v })} placeholder="Jul 2025 / Present" />
              <Field label="Location" value={x.location} onChange={(v) => set({ location: v })} placeholder="Remote" wide />
              <Area label="What you did (one per line)" value={x.bullets} onChange={(v) => set({ bullets: v })} rows={4} placeholder={"Built X using Y, cutting Z by 30%\nAutomated …"} />
            </>
          )}
        />
      </Section>

      <Section title="Projects" hint="Your first project is mentioned in your emails.">
        <ListEditor<Project>
          items={p.projects} onChange={(v) => update({ projects: v })} addLabel="Add project"
          blank={{ name: "", tech: "", link: "", bullets: "" }}
          render={(x, set) => (
            <>
              <Field label="Project name" value={x.name} onChange={(v) => set({ name: v })} />
              <Field label="Tech used" value={x.tech} onChange={(v) => set({ tech: v })} placeholder="Next.js, Python" />
              <Field label="Link" value={x.link} onChange={(v) => set({ link: v })} wide />
              <Area label="What it does / your impact (one per line)" value={x.bullets} onChange={(v) => set({ bullets: v })} rows={3} />
            </>
          )}
        />
      </Section>

      <Section title="Other education" hint="Class 12 / 10, diploma… (your college is above).">
        <ListEditor<Education>
          items={p.education} onChange={(v) => update({ education: v })} addLabel="Add education"
          blank={{ school: "", degree: "", year: "", score: "" }}
          render={(x, set) => (
            <>
              <Field label="School / board" value={x.school} onChange={(v) => set({ school: v })} />
              <Field label="Class / course" value={x.degree} onChange={(v) => set({ degree: v })} placeholder="Class XII (CBSE)" />
              <Field label="Year" value={x.year} onChange={(v) => set({ year: v })} />
              <Field label="Score" value={x.score} onChange={(v) => set({ score: v })} placeholder="92%" />
            </>
          )}
        />
      </Section>

      <Section title="Achievements & certifications" hint="One per line.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Area label="Achievements" value={p.achievements} onChange={(v) => update({ achievements: v })} rows={4} placeholder={"Rank 120 in CodeChef Starters\nWinner, college hackathon 2025"} />
          <Area label="Certifications" value={p.certifications} onChange={(v) => update({ certifications: v })} rows={4} />
        </div>
      </Section>

      <Section title="Application forms" hint="Extra details job forms keep asking for. The Chrome extension fills these in; leave anything blank to skip it.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice label="Gender" value={p.gender} onChange={(v) => update({ gender: v })} options={["Male", "Female", "Non-binary", "Prefer not to say"]} />
          <Field label="Date of birth" type="date" value={p.dob} onChange={(v) => update({ dob: v })} />
          <Field label="Address" value={p.address} onChange={(v) => update({ address: v })} placeholder="House no., street, area" wide />
          <Field label="State" value={p.state} onChange={(v) => update({ state: v })} placeholder="Delhi" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country" value={p.country} onChange={(v) => update({ country: v })} placeholder="India" />
            <Field label="PIN code" value={p.pincode} onChange={(v) => update({ pincode: v })} placeholder="110001" />
          </div>
          <Field label="Work experience (years)" value={p.experienceYears} onChange={(v) => update({ experienceYears: v })} placeholder="0 for freshers" />
          <Field label="Notice period" value={p.noticePeriod} onChange={(v) => update({ noticePeriod: v })} placeholder="Immediate / 30 days" />
          <Field label="Current CTC / stipend" value={p.currentCtc} onChange={(v) => update({ currentCtc: v })} placeholder="0 / 3.6 LPA" />
          <Field label="Expected CTC" value={p.expectedCtc} onChange={(v) => update({ expectedCtc: v })} placeholder="6 LPA" />
          <Choice label="Willing to relocate" value={p.relocate} onChange={(v) => update({ relocate: v })} options={["Yes", "No"]} />
        </div>
      </Section>

      <Section title="Saved answers" hint='For other questions forms keep asking. When a question contains your words, the extension answers it. E.g. "hear about" → LinkedIn, "previously worked" → No, "authorized to work" → Yes.'>
        <ListEditor<Answer>
          items={p.answers} onChange={(v) => update({ answers: v })} addLabel="Add an answer"
          blank={{ q: "", a: "" }}
          render={(x, set) => (
            <>
              <Field label="If the question contains" value={x.q} onChange={(v) => set({ q: v })} placeholder="hear about" />
              <Field label="Answer" value={x.a} onChange={(v) => set({ a: v })} placeholder="LinkedIn" />
            </>
          )}
        />
      </Section>

      <Section id="extension" title="Chrome extension: autofill job forms" hint="Fills Google Forms, Workday, company career pages and more with the details on this page.">
        <ExtensionCard />
      </Section>

      <Section title="Message templates" hint="Edit the wording used in the Apply kit. Placeholders like {company} {role} {name} {college} {skills} {resume} {linkedin} {contact} are filled in for you; a line whose placeholder is empty is left out.">
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => <button key={k.id} onClick={() => setKind(k.id)} className={`rounded-full px-3 py-1 text-sm font-bold ${kind === k.id ? "bg-indigo-600 text-white" : "bg-slate-500/10"}`}>{k.label}</button>)}
          <span className="mx-1 w-px bg-slate-500/20" />
          {TONES.map((t) => <button key={t} onClick={() => setTone(t)} className={`rounded-full px-3 py-1 text-sm font-bold capitalize ${tone === t ? "bg-pink-500 text-white" : "bg-slate-500/10"}`}>{t}</button>)}
        </div>
        <label className={lbl}>Subject<input className={inp} value={tpl[kind][tone].subject} onChange={(e) => updateTpl("subject", e.target.value)} /></label>
        <label className={lbl}>Message<textarea className={`${inp} min-h-64 font-mono text-xs leading-relaxed`} value={tpl[kind][tone].body} onChange={(e) => updateTpl("body", e.target.value)} /></label>
        <button className="btn-ghost" onClick={() => { const n = { ...tpl, [kind]: { ...tpl[kind], [tone]: DEFAULT_TEMPLATES[kind][tone] } }; setTpl(n); saveTemplates(n); }}>Reset this template</button>
      </Section>

      <Section title="Backup / move to another device" hint="Downloads your profile, templates, tracker and jobs you added by hand. Import the file on your phone to continue there.">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={exportAll}>⬇ Export backup</button>
          <button className="btn-ghost" onClick={() => file.current?.click()}>⬆ Import backup</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => importAll(e.target.files?.[0])} />
        </div>
      </Section>
    </div>
  );
}
