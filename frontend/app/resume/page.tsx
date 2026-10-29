"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AtsCheck from "@/components/AtsCheck";
import ResumeDoc, { BASE_PT, DEFAULT_OPTIONS, TRIM_STEPS, density, type ResumeOptions, type ResumeTemplate } from "@/components/ResumeDoc";
import { atsReport, fitNotes, sheetText, type Fit } from "@/lib/atsCheck";
import { parseResume, type ParsedResume } from "@/lib/resumeParse";
import { fetchJobs, jobTitle, type Job } from "@/lib/jobs";
import { parseJobCached } from "@/lib/extract";
import { matchKeywords } from "@/lib/keywords";
import { isProfileStarted, loadProfile, saveProfile, skillList, type Profile } from "@/lib/profile";
import { loadJSON, saveJSON } from "@/lib/store";

const ACCENTS = ["#7c3aed", "#db2777", "#2563eb", "#059669", "#ea580c", "#111111"];
const TEMPLATES: { id: ResumeTemplate; label: string; hint: string }[] = [
  { id: "modern", label: "Modern", hint: "Coloured name and headings" },
  { id: "classic", label: "Classic", hint: "Black and white, centred" },
  { id: "compact", label: "Compact", hint: "Smaller, fits more on one page" },
];
const SHEET_PX = 793.7; // 210mm
const PAGE_PX = (296 * 96) / 25.4 - 3; // the printed sheet is 296mm tall; keep a little room for print rounding

const profileText = (p: Profile) =>
  [p.headline, p.summary, p.skills, p.degree, ...p.experience.flatMap((x) => [x.role, x.bullets]), ...p.projects.flatMap((x) => [x.name, x.tech, x.bullets]), p.achievements, p.certifications].join("\n");

function ResumeBuilder() {
  const params = useSearchParams();
  const [p, setP] = useState<Profile | null>(null);
  const [o, setO] = useState<ResumeOptions>(DEFAULT_OPTIONS);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsNote, setJobsNote] = useState("");
  const [jobId, setJobId] = useState(params.get("job") ?? "");
  const [scale, setScale] = useState(1);
  const [mounted, setMounted] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [trial, setTrial] = useState({ sig: "", level: 0 }); // which trim step the hidden copy is trying
  const [fit, setFit] = useState<Fit & { sig: string }>({ sig: "", level: 0, t: 0, overflow: false, textPt: 10.2 });
  const [parsed, setParsed] = useState<ParsedResume | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const measureBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    document.fonts?.ready.then(() => setFontsReady(true));
    setP(loadProfile());
    setO({ ...DEFAULT_OPTIONS, ...loadJSON<Partial<ResumeOptions>>("resume_opts", {}) });
    const manual = loadJSON<Job[]>("jobs_manual", []);
    fetchJobs(loadJSON<string>("jobs_pw", ""))
      .then((f) => setJobs([...manual, ...f.jobs]))
      .catch(() => {
        setJobs(manual);
        setJobsNote("Unlock your jobs on the home page to tailor for them.");
      });
  }, []);

  // fit the A4 preview to the screen width
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / SHEET_PX)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [p]);

  const setOpt = (patch: Partial<ResumeOptions>) => {
    const next = { ...o, ...patch };
    setO(next);
    saveJSON("resume_opts", next);
  };

  const job = jobs.find((j) => j.id === jobId);
  const match = useMemo(() => (job && p ? matchKeywords(job.text, profileText(p)) : null), [job, p]);
  // when tailoring, skills the job asks for go first
  const skills = useMemo(() => {
    if (!p) return [];
    const all = skillList(p);
    if (!match) return all;
    const hit = (s: string) => matchKeywords(job!.text, s).matched.length > 0; // alias-aware: "Data Structures" counts for "DSA"
    return [...all.filter(hit), ...all.filter((s) => !hit(s))];
  }, [p, match, job]);

  // Always one page: tighten spacing, then text (down to 8.6pt), and only then show fewer points/sections.
  const sig = useMemo(() => JSON.stringify([p, o, skills, fontsReady]), [p, o, skills, fontsReady]);
  const level = trial.sig === sig ? trial.level : 0;
  useLayoutEffect(() => {
    const el = measureBox.current?.querySelector<HTMLElement>("[data-resume-sheet]");
    if (!el || !p) return;
    const apply = (t: number) => {
      const d = density(t, o.template);
      el.style.setProperty("--s", String(d.s));
      el.style.setProperty("--k", String(d.k));
      return el.getBoundingClientRect().height <= PAGE_PX;
    };
    const last = level >= TRIM_STEPS.length - 1;
    if (!apply(1) && !last) {
      setTrial({ sig, level: level + 1 }); // still too long at the smallest size: show less, measure again
      return;
    }
    let t = 0;
    if (!apply(0)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (apply(mid)) hi = mid;
        else lo = mid;
      }
      t = hi;
    }
    const overflow = !apply(t);
    setFit({ sig, level, t, overflow, textPt: BASE_PT[o.template] * density(t, o.template).k });
    try {
      setParsed(parseResume(sheetText(el))); // read it back like an ATS
    } catch {
      setParsed(null);
    }
  }, [sig, level]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = TRIM_STEPS[fit.level] ?? TRIM_STEPS[0];
  const dens = density(fit.t, o.template);
  const report = useMemo(
    () => (p ? atsReport({ p, o, limits, fit, parsed, skills, jobScore: match?.score }) : null),
    [p, o, limits, fit, parsed, skills, match],
  );
  const notes = p ? fitNotes(p, o, limits, fit) : [];

  const addSkill = (k: string) => {
    if (!p) return;
    const name = k.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Sql\b/, "SQL").replace(/Aws\b/, "AWS").replace(/Dsa\b/, "DSA");
    const next = { ...p, skills: [...skillList(p), name].join(", ") };
    setP(next);
    saveProfile(next);
  };

  if (!p) return <div className="card skeleton h-96" />;
  const jobLabel = (j: Job) => {
    const x = parseJobCached(j.text);
    return `${j.role ?? x.role ?? jobTitle(j.text)}${(j.company ?? x.company) ? ` · ${j.company ?? x.company}` : ""}`.slice(0, 80);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="font-display text-4xl font-black text-white drop-shadow-[0_4px_18px_rgba(90,40,170,.35)]">Resume builder</h1>
          <p className="text-sm font-semibold text-white/90">Made from <Link href="/profile" className="underline">your profile</Link>. One page, readable by applicant tracking systems.</p>
        </div>
        <button className="btn-pill" onClick={() => window.print()}>⬇ Download PDF</button>
      </div>

      {!isProfileStarted(p) && (
        <div className="card p-5 text-sm">
          Your profile is empty, so this is a blank template. <Link href="/profile" className="font-bold text-indigo-600 underline dark:text-indigo-400">Fill in your profile</Link> and come back.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <aside className="space-y-4">
          <div className="card space-y-3 p-4">
            <h2 className="font-display font-black">Template</h2>
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => setOpt({ template: t.id })} aria-pressed={o.template === t.id}
                  className={`rounded-2xl border-2 p-2.5 text-left text-sm transition ${o.template === t.id ? "border-indigo-600 bg-indigo-600/10" : "border-transparent bg-slate-500/10 hover:bg-slate-500/20"}`}>
                  <b>{t.label}</b><span className="hidden text-xs text-slate-500 lg:block">{t.hint}</span>
                </button>
              ))}
            </div>
            {o.template === "modern" && (
              <div className="flex flex-wrap gap-2" aria-label="Accent colour">
                {ACCENTS.map((c) => (
                  <button key={c} onClick={() => setOpt({ accent: c })} aria-label={`Accent ${c}`} aria-pressed={o.accent === c}
                    className={`h-7 w-7 rounded-full transition ${o.accent === c ? "ring-4 ring-indigo-500/50 ring-offset-2" : "hover:scale-110"}`} style={{ background: c }} />
                ))}
              </div>
            )}
            <div className="space-y-1.5 text-sm">
              {([["showSummary", "Summary"], ["showAchievements", "Achievements"], ["showCertifications", "Certifications"]] as const).map(([k, l]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={o[k]} onChange={(e) => setOpt({ [k]: e.target.checked })} /> Show {l}</label>
              ))}
            </div>
          </div>

          <div className="card space-y-3 p-4">
            <h2 className="font-display font-black">🎯 Tailor for a job</h2>
            <select className="input" aria-label="Job to tailor for" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Choose a job…</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}
            </select>
            {jobsNote && <p className="text-xs text-slate-500">{jobsNote}</p>}
            {match && (match.score === null ? (
              <p className="text-sm text-slate-500">This post doesn&apos;t list specific skills. Read it and make sure your top skills fit the role.</p>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="font-display grid h-14 w-14 place-items-center rounded-full text-lg font-black text-white" style={{ background: match.score >= 70 ? "#10b981" : match.score >= 40 ? "#f59e0b" : "#f43f5e" }}>{match.score}%</div>
                  <p className="text-sm">You match <b>{match.matched.length}</b> of <b>{match.wanted.length}</b> skills this job mentions. Matching skills are moved to the front of your resume.</p>
                </div>
                {match.matched.length > 0 && <div className="flex flex-wrap gap-1.5">{match.matched.map((k) => <span key={k} className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">✓ {k}</span>)}</div>}
                {match.missing.length > 0 && (
                  <>
                    <p className="text-xs text-slate-500">Missing from your profile. Add only the ones you really know:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {match.missing.map((k) => <button key={k} onClick={() => addSkill(k)} className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 hover:bg-rose-200 dark:bg-rose-950 dark:text-rose-300">＋ {k}</button>)}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {report && <AtsCheck score={report.score} groups={report.groups} />}

          <p className="px-1 text-xs text-white/90">Download PDF opens your browser&apos;s print window: choose <b>Save as PDF</b>, paper <b>A4</b>, and turn off <b>Headers and footers</b>.</p>
        </aside>

        <div ref={box} className="min-w-0">
          <div style={{ height: `calc(297mm * ${scale})` }} className="overflow-hidden">
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "210mm" }} className="shadow-2xl shadow-violet-900/30">
              <ResumeDoc p={p} o={o} skills={skills} limits={limits} fit={dens} />
            </div>
          </div>
          <p className="mt-2 text-xs font-semibold text-white/90" data-testid="fit-status">
            {fit.overflow ? "⚠ Too long for one page even at the smallest size: shorten your points on My profile." : notes.length ? `✓ One page. To fit: ${notes.join(", ")}.` : `✓ One page, text ${fit.textPt.toFixed(1)}pt.`}
          </p>
        </div>
      </div>

      {/* hidden copy at full width, used to measure height and to read the text back like an ATS */}
      <div ref={measureBox} aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
        <ResumeDoc p={p} o={o} skills={skills} limits={TRIM_STEPS[level]} measure />
      </div>
      {mounted && createPortal(<div id="print-root"><ResumeDoc p={p} o={o} skills={skills} limits={limits} fit={dens} page /></div>, document.body)}
    </div>
  );
}

export default function ResumePage() {
  return (
    <Suspense fallback={<div className="card skeleton h-96" />}>
      <ResumeBuilder />
    </Suspense>
  );
}
