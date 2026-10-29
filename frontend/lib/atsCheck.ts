import { BASE_PT, NO_LIMITS, scrub, visibleContent, type Limits, type ResumeOptions } from "@/components/ResumeDoc";
import type { Profile } from "./profile";
import type { ParsedResume } from "./resumeParse";
import type { ResumeText } from "./resumeFile";

/** The resume as a PDF reader / ATS sees it: words grouped into lines by position, wide gaps kept as 3 spaces. */
export function sheetText(el: HTMLElement): ResumeText {
  const words: { x: number; y: number; h: number; w: number; s: string }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    for (const m of n.data.matchAll(/\S+/g)) {
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width || r.height) words.push({ x: r.left, y: r.top + r.height / 2, h: r.height, w: r.width, s: m[0] });
    }
  }
  const rows: { y: number; items: typeof words }[] = [];
  for (const w of words) {
    let row = rows.find((r) => Math.abs(r.y - w.y) < w.h * 0.45);
    if (!row) rows.push((row = { y: w.y, items: [] }));
    row.items.push(w);
  }
  rows.sort((a, b) => a.y - b.y);
  const lines = rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let line = "";
    let end = -Infinity;
    for (const w of r.items) {
      if (line) line += w.x - end > w.h * 1.5 ? "   " : " ";
      line += w.s;
      end = w.x + w.w;
    }
    return line;
  });
  const links = [...el.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href);
  return { lines, links };
}

export type Level = "pass" | "warn" | "fail";
export interface CheckItem { level: Level; label: string; hint?: string; weight: number }
export interface CheckGroup { title: string; items: CheckItem[] }
export interface Fit { level: number; t: number; overflow: boolean; textPt: number }

// Action verbs in any form ("Built", "Builds", "Collects", "Encrypted", "Optimising"…).
const VERBS = "build|built|develop|design|implement|creat|lead|led|manag|improv|reduc|increas|automat|analy[sz]|deploy|integrat|optimi[sz]|conduct|research|train|achiev|deliver|maintain|test|migrat|architect|spearhead|coordinat|organi[sz]|launch|engineer|contribut|enhanc|streamlin|establish|mentor|ship|refactor|scal|writ|wrote|win|won|secur|rank|collaborat|present|publish|cut|boost|sav|generat|resolv|debug|program|model|visuali[sz]|scrap|containeri[sz]|author|accelerat|simplif|standardi[sz]|monitor|prepar|predict|classif|fine-tun|clean|process|configur|set up|add|made|mak|convert|translat|negotiat|sold|sell|grew|grow|drove|driv|plan|evaluat|identif|review|audit|document|taught|teach|tutor|host|found|head|ran|run|complet|solv|earn|receiv|qualif|select|award|collect|encrypt|aggregat|fetch|track|detect|recommend|enabl|support|provid|allow|let|pars|schedul|sync|stor|send|sent|notif|render|extract|filter|match|search|comput|calculat|benchmark|own|serv|power|captur|label|summari[sz]|forecast|recogni[sz]|segment|transform|validat|verif|secur|authenticat|host|cach|index|queri|stream|handl|achiev|reach|attract|onboard|recruit|interview|market|promot|campaign|grow|expand|negotiat|pitch|clos|resolv|investigat|assess|survey|measur|map|prototyp|wirefram|illustrat|edit|film|shot|shoot|craft|compos|translat|speak|spoke|mentor|coach|volunteer|organis|organiz"; // stems
const STRONG = new RegExp(`^(?:${VERBS})[a-z]*\\b`, "i");
const WEAK = /^(responsible for|worked (on|with|in)|helped|assisted|involved in|tasked with|participated in|duties|various|did)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const PRONOUN = /\b(I|my|me|we|our)\b/;
const norm = (s = "") => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (s = "") => s.replace(/\D/g, "").slice(-10);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What on the resume an ATS will struggle with, plus a 0–100 score. */
export function atsReport(args: {
  p: Profile; o: ResumeOptions; limits: Limits; fit: Fit | null; parsed: ParsedResume | null; skills: string[]; jobScore?: number | null;
}): { score: number; groups: CheckGroup[] } {
  const { o, limits, fit, parsed, skills, jobScore } = args;
  const raw = args.p;
  const p = scrub(raw); // compare with what is actually printed
  const v = visibleContent(p, o, limits);
  const groups: CheckGroup[] = [];

  // 1. Read it back like an ATS would.
  if (parsed) {
    const read: CheckItem[] = [];
    const same = (label: string, mine: string, got: string | undefined, eq: (a: string, b: string) => boolean, fixHint: string) => {
      if (!mine.trim()) read.push({ level: "fail", label: `${label}: missing`, hint: fixHint, weight: 3 });
      else if (got && eq(mine, got)) read.push({ level: "pass", label: `${label}: ${got}`, weight: 3 });
      else read.push({ level: "fail", label: `${label} not read correctly`, hint: got ? `Read as "${got}"` : "An ATS would miss it.", weight: 3 });
    };
    same("Name", p.name, parsed.name, (a, b) => norm(a) === norm(b), "Add your name on My profile.");
    same("Email", p.email, parsed.email, (a, b) => a.trim().toLowerCase() === b.toLowerCase(), "Add your email on My profile.");
    same("Phone", p.phone, parsed.phone, (a, b) => digits(a) === digits(b), "Add your phone number on My profile.");
    if (p.college) {
      const ok = norm(parsed.college) === norm(p.college) && (!p.batch || parsed.batch === p.batch.trim());
      read.push(ok
        ? { level: "pass", label: `Education: ${[parsed.college, parsed.batch, parsed.cgpa && `CGPA ${parsed.cgpa}`].filter(Boolean).join(" · ")}`, weight: 2 }
        : { level: "warn", label: "Education only partly read", hint: `Read: ${parsed.college || "no college"}${parsed.batch ? `, ${parsed.batch}` : ""}`, weight: 2 });
    }
    for (const [key, label] of [["experience", "Experience"], ["projects", "Projects"]] as const) {
      const shown = v[key].length;
      if (!shown) continue;
      const got = parsed[key]?.length ?? 0;
      read.push(got === shown
        ? { level: "pass", label: `${label}: all ${shown} read`, weight: 2 }
        : { level: "warn", label: `${label}: ${got} of ${shown} read`, hint: "Give each one a clear title line (role/company or project name).", weight: 2 });
    }
    if (skills.length) {
      const got = (parsed.skills ?? "").split(",").filter((s) => s.trim()).length;
      read.push(got >= Math.ceil(skills.length * 0.8)
        ? { level: "pass", label: `Skills: ${plural(got, "skill")} read`, weight: 2 }
        : { level: "warn", label: `Skills: ${got} of ${skills.length} read`, weight: 2 });
    }
    groups.push({ title: "What an ATS reads", items: read });
  }

  // 2. Format
  const format: CheckItem[] = [
    { level: "pass", label: "One column, real text, standard headings", hint: "No tables, images or icons; contact details in the page itself.", weight: 1 },
  ];
  if (fit) {
    format.push(fit.overflow
      ? { level: "fail", label: "Longer than one page", hint: "Even squeezed it doesn't fit: shorten your points on My profile.", weight: 3 }
      : { level: "pass", label: "Fits on one page", weight: 3 });
    format.push(fit.textPt >= 9.5
      ? { level: "pass", label: `Text size ${fit.textPt.toFixed(1)}pt`, weight: 1 }
      : { level: "warn", label: `Text shrunk to ${fit.textPt.toFixed(1)}pt to fit`, hint: "Shorten a few points so the text can be bigger (9.5pt+ reads best).", weight: 1 });
  }
  const allText = [raw.name, raw.headline, raw.summary, raw.skills, raw.degree, ...raw.experience.flatMap((x) => [x.role, x.company, x.bullets]), ...raw.projects.flatMap((x) => [x.name, x.tech, x.bullets]), raw.achievements, raw.certifications].join("\n");
  format.push(EMOJI.test(allText)
    ? { level: "pass", label: "Emojis left out of the PDF", hint: "ATS software turns them into junk, so the resume skips them (your profile keeps them).", weight: 1 }
    : { level: "pass", label: "No emojis or odd symbols", weight: 1 });
  groups.push({ title: "Format", items: format });

  // 3. Content
  const content: CheckItem[] = [];
  const points = [...v.experience, ...v.projects].flatMap((x) => x.points);
  if (!v.experience.length && !v.projects.length) content.push({ level: "fail", label: "No experience or projects", hint: "Add at least one internship or project on My profile.", weight: 2 });
  if (points.length) {
    const strong = points.filter((b) => STRONG.test(b)).length;
    const weak = points.find((b) => WEAK.test(b));
    content.push(strong / points.length >= 0.7 && !weak
      ? { level: "pass", label: `${strong} of ${points.length} points start with an action verb`, weight: 1 }
      : { level: "warn", label: `${strong} of ${points.length} points start with an action verb`, hint: weak ? `Rewrite "${weak.slice(0, 40)}…" to start with Built, Led, Improved…` : "Start each point with Built, Led, Improved, Reduced…", weight: 1 });
    const nums = points.filter((b) => /\d/.test(b)).length;
    content.push(nums / points.length >= 0.4
      ? { level: "pass", label: `${nums} of ${points.length} points show numbers`, weight: 1 }
      : { level: "warn", label: `Only ${nums} of ${points.length} points show numbers`, hint: "Add results: %, users, time saved, rank, accuracy.", weight: 1 });
    const long = points.filter((b) => b.length > 220).length;
    const short = points.filter((b) => b.length < 25).length;
    if (long) content.push({ level: "warn", label: `${plural(long, "point")} over 2 lines`, hint: "Keep each point to 1–2 lines.", weight: 1 });
    if (short) content.push({ level: "warn", label: `${plural(short, "point")} too short`, hint: "Say what you did, how, and the result.", weight: 1 });
  }
  if (PRONOUN.test([v.summary, ...points].join(" "))) content.push({ level: "warn", label: "Uses I / my / we", hint: "Resumes leave these out: \"Built…\", not \"I built…\".", weight: 1 });
  content.push(skills.length >= 6 && skills.length <= 30
    ? { level: "pass", label: `${plural(skills.length, "skill")} listed`, weight: 1 }
    : { level: "warn", label: skills.length < 6 ? `Only ${plural(skills.length, "skill")}` : `${skills.length} skills is a lot`, hint: skills.length < 6 ? "List at least 6 tools and languages you know." : "Keep the 15–25 that matter most.", weight: 1 });
  const missingEdu = [!p.degree && "degree", !p.batch && "grad year", !p.cgpa && "CGPA"].filter(Boolean);
  if (p.college && missingEdu.length) content.push({ level: "warn", label: `Education is missing ${missingEdu.join(", ")}`, weight: 1 });
  if (v.experience.some((x) => !x.start)) content.push({ level: "warn", label: "Some experience has no dates", hint: "Add month and year, e.g. May 2025 – Jul 2025.", weight: 1 });
  if (!p.linkedin) content.push({ level: "warn", label: "No LinkedIn link", hint: "Recruiters check it: add it on My profile.", weight: 1 });
  if (v.summary && v.summary.split(/\s+/).length > 60) content.push({ level: "warn", label: "Summary over 60 words", hint: "2–3 short lines is enough.", weight: 1 });
  if (jobScore != null) {
    content.push(jobScore >= 60
      ? { level: "pass", label: `Matches ${jobScore}% of the job's skills`, weight: 2 }
      : { level: jobScore >= 30 ? "warn" : "fail", label: `Matches ${jobScore}% of the job's skills`, hint: "Add the missing skills you really have (see Tailor for a job).", weight: 2 });
  }
  groups.push({ title: "Content", items: content });

  const all = groups.flatMap((g) => g.items);
  const total = all.reduce((s, i) => s + i.weight, 0);
  const got = all.reduce((s, i) => s + i.weight * (i.level === "pass" ? 1 : i.level === "warn" ? 0.5 : 0), 0);
  return { score: total ? Math.round((got / total) * 100) : 0, groups };
}

/** What the one-page fit had to change, in words. */
export function fitNotes(raw: Profile, o: ResumeOptions, limits: Limits, fit: Fit): string[] {
  const p = scrub(raw);
  const full = visibleContent(p, o, NO_LIMITS);
  const cut = visibleContent(p, o, limits);
  const notes: string[] = [];
  if (fit.t > 0) notes.push(fit.textPt < BASE_PT[o.template] ? `tighter spacing, text ${fit.textPt.toFixed(1)}pt` : "tighter spacing");
  const pts = (c: typeof full) => [...c.experience, ...c.projects].reduce((s, x) => s + x.points.length, 0);
  if (pts(cut) < pts(full)) notes.push(`up to ${plural(limits.bullets, "point")} per job/project`);
  if (cut.experience.length < full.experience.length) notes.push(`first ${cut.experience.length} of ${full.experience.length} experiences`);
  if (cut.projects.length < full.projects.length) notes.push(`first ${cut.projects.length} of ${full.projects.length} projects`);
  if (full.summary && !cut.summary) notes.push("summary hidden");
  if (cut.achievements.length < full.achievements.length) notes.push(cut.achievements.length ? `first ${cut.achievements.length} achievements` : "achievements hidden");
  if (cut.certifications.length < full.certifications.length) notes.push(cut.certifications.length ? `first ${cut.certifications.length} certifications` : "certifications hidden");
  return notes;
}
