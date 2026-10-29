"use client";

import { useEffect, useRef, useState } from "react";
import type { Profile } from "@/lib/profile";
import type { ParsedResume } from "@/lib/resumeParse";
import { useToast } from "./Toast";

type TextKey = Exclude<keyof ParsedResume, "experience" | "projects" | "education">;
type ListKey = "experience" | "projects" | "education";

const TEXT_FIELDS: { key: TextKey; label: string; long?: boolean }[] = [
  { key: "name", label: "Full name" },
  { key: "headline", label: "Headline" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "City" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "github", label: "GitHub" },
  { key: "portfolio", label: "Portfolio" },
  { key: "college", label: "College / university" },
  { key: "degree", label: "Degree & branch" },
  { key: "batch", label: "Batch (grad year)" },
  { key: "cgpa", label: "CGPA / %" },
  { key: "skills", label: "Skills", long: true },
  { key: "summary", label: "Summary", long: true },
  { key: "achievements", label: "Achievements", long: true },
  { key: "certifications", label: "Certifications", long: true },
];
const LIST_FIELDS: { key: ListKey; label: string }[] = [
  { key: "experience", label: "Experience" },
  { key: "projects", label: "Projects" },
  { key: "education", label: "Other education (Class XII / X…)" },
];

const describe = (key: ListKey, x: Record<string, string>) =>
  key === "experience" ? [x.role, x.company].filter(Boolean).join(" at ") + (x.start ? ` (${x.start} – ${x.end || "?"})` : "")
  : key === "projects" ? x.name + (x.tech ? ` · ${x.tech}` : "")
  : [x.degree, x.school, x.year, x.score].filter(Boolean).join(" · ");

/** "Fill from my resume": read a PDF / Word resume in the browser, let you check it, then fill the profile. */
export default function ResumeImport({ profile, onApply }: { profile: Profile; onApply: (patch: Partial<Profile>) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [found, setFound] = useState<ParsedResume | null>(null);

  async function read(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    try {
      const [{ readResume }, { parseResume }] = await Promise.all([import("@/lib/resumeFile"), import("@/lib/resumeParse")]);
      const parsed = parseResume(await readResume(file));
      if (Object.keys(parsed).length < 2) toast("Couldn't find any text in that file. A scanned photo can't be read: export the PDF from Word, Google Docs or Overleaf.");
      else setFound(parsed);
    } catch (e) {
      toast(e instanceof Error && "friendly" in e ? e.message : "Couldn't read that file. Try the PDF version of your resume.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <section
        className={`card flex flex-wrap items-center gap-4 p-5 transition ${drag ? "ring-4 ring-violet-400/60" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]); }}
      >
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-pink-300 to-violet-500 text-2xl shadow-md" aria-hidden="true">📄</div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-black">Fill from my resume</h2>
          <p className="text-xs text-slate-500">Upload your resume (PDF or Word) or drop it here, and this page gets filled in. You choose what to keep and can edit anything. Read in your browser, never uploaded.</p>
        </div>
        <button className="btn-primary" onClick={() => input.current?.click()} disabled={busy}>{busy ? "Reading…" : "⬆ Upload resume"}</button>
        <input ref={input} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(e) => read(e.target.files?.[0])} aria-label="Resume file" />
      </section>
      {found && (
        <Review
          found={found}
          profile={profile}
          onClose={() => setFound(null)}
          onApply={(patch) => {
            onApply(patch);
            setFound(null);
            toast(`Filled ${Object.keys(patch).length} section${Object.keys(patch).length === 1 ? "" : "s"} from your resume. Check below and change anything.`, "success");
          }}
        />
      )}
    </>
  );
}

function Review({ found, profile, onClose, onApply }: { found: ParsedResume; profile: Profile; onClose: () => void; onApply: (patch: Partial<Profile>) => void }) {
  const texts = TEXT_FIELDS.filter((f) => found[f.key] && found[f.key] !== profile[f.key]);
  const lists = LIST_FIELDS.filter((f) => found[f.key]?.length);
  // Ticked by default when the profile has nothing there yet; you decide about replacing what you typed.
  const [values, setValues] = useState(() => Object.fromEntries(texts.map((f) => [f.key, found[f.key] as string])) as Record<TextKey, string>);
  const [pick, setPick] = useState(() => Object.fromEntries([...texts, ...lists].map((f) => [f.key, !profile[f.key].length])) as Record<string, boolean>);
  const chosen = Object.values(pick).filter(Boolean).length;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  function apply() {
    const patch: Partial<Profile> = {};
    for (const f of texts) if (pick[f.key] && values[f.key].trim()) patch[f.key] = values[f.key].trim();
    for (const f of lists) if (pick[f.key]) Object.assign(patch, { [f.key]: found[f.key] });
    onApply(patch);
  }

  const box = "mt-1 h-4 w-4 shrink-0 accent-violet-600";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card animate-pop-in flex max-h-[92vh] w-full max-w-2xl flex-col" role="dialog" aria-modal="true" aria-label="Check what was found in your resume">
        <div className="flex items-start justify-between gap-3 border-b border-slate-500/15 p-5 pb-3">
          <div>
            <h2 className="font-display text-xl font-black">Found in your resume</h2>
            <p className="text-xs text-slate-500">Fix anything that looks wrong and untick what you don&apos;t want. Ticked items go into your profile.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
          {texts.map((f) => (
            <div key={f.key} className="flex gap-3 rounded-2xl border border-slate-500/15 p-3">
              <input type="checkbox" className={box} checked={pick[f.key]} onChange={(e) => setPick({ ...pick, [f.key]: e.target.checked })} aria-label={`Use ${f.label}`} />
              <label className="min-w-0 flex-1 space-y-1 text-sm font-semibold">
                {f.label}
                {f.long ? (
                  <textarea className="input font-normal" rows={Math.min(5, values[f.key].split("\n").length + 1)} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                ) : (
                  <input className="input font-normal" value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                )}
                {profile[f.key] && <span className="block truncate text-xs font-normal text-slate-500">Now: {profile[f.key]}</span>}
              </label>
            </div>
          ))}
          {lists.map((f) => {
            const items = found[f.key] as unknown as Record<string, string>[];
            const have = profile[f.key].length;
            return (
              <label key={f.key} className="flex cursor-pointer gap-3 rounded-2xl border border-slate-500/15 p-3 text-sm">
                <input type="checkbox" className={box} checked={pick[f.key]} onChange={(e) => setPick({ ...pick, [f.key]: e.target.checked })} />
                <span className="min-w-0 flex-1">
                  <b>{f.label}</b>
                  <span className="text-xs text-slate-500"> · {items.length} found{have ? `, replaces your ${have}` : ""}</span>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-600 dark:text-slate-300">
                    {items.map((x, i) => <li key={i} className="break-words">{describe(f.key, x)}</li>)}
                  </ul>
                </span>
              </label>
            );
          })}
          {!texts.length && !lists.length && <p className="text-sm text-slate-500">Everything in your resume is already on your profile.</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-500/15 p-4">
          <button className="btn-primary" onClick={apply} disabled={!chosen}>Use {chosen} selected</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <span className="ml-auto text-xs text-slate-500">You can edit everything on the page afterwards.</span>
        </div>
      </div>
    </div>
  );
}
