import { asUrl, lines, skillList, type Profile } from "@/lib/profile";

export type ResumeTemplate = "classic" | "modern" | "compact";
export interface ResumeOptions {
  template: ResumeTemplate;
  accent: string;
  showSummary: boolean;
  showAchievements: boolean;
  showCertifications: boolean;
}
export const DEFAULT_OPTIONS: ResumeOptions = { template: "modern", accent: "#7c3aed", showSummary: true, showAchievements: true, showCertifications: true };

/** How much of each section is shown. Trimmed step by step only when the page can't fit otherwise. */
export interface Limits {
  bullets: number; // points per job / project
  experience: number;
  projects: number;
  achievements: number;
  certifications: number;
  summary: boolean;
}
export const NO_LIMITS: Limits = { bullets: 99, experience: 99, projects: 99, achievements: 99, certifications: 99, summary: true };
// Fewer points per entry first, then the summary, and only then whole jobs / projects.
export const TRIM_STEPS: Limits[] = [
  NO_LIMITS,
  { bullets: 4, experience: 99, projects: 99, achievements: 5, certifications: 4, summary: true },
  { bullets: 3, experience: 99, projects: 99, achievements: 4, certifications: 3, summary: true },
  { bullets: 3, experience: 99, projects: 99, achievements: 3, certifications: 2, summary: false },
  { bullets: 2, experience: 99, projects: 99, achievements: 3, certifications: 2, summary: false },
  { bullets: 2, experience: 4, projects: 4, achievements: 3, certifications: 2, summary: false },
  { bullets: 2, experience: 3, projects: 3, achievements: 2, certifications: 0, summary: false },
  { bullets: 1, experience: 3, projects: 3, achievements: 2, certifications: 0, summary: false },
  { bullets: 1, experience: 2, projects: 2, achievements: 2, certifications: 0, summary: false },
];

/** Squeeze: s = spacing (1 → 0.6), k = text size (1 → MIN_TEXT_PT / base). */
export interface Density { s: number; k: number }
export const BASE_PT = { modern: 10.2, classic: 10.2, compact: 9.4 } as const;
export const MIN_TEXT_PT = 8.6;
export function density(t: number, template: ResumeTemplate): Density {
  const kMin = Math.min(1, MIN_TEXT_PT / BASE_PT[template]);
  return t <= 0.5 ? { s: 1 - 0.8 * t, k: 1 } : { s: 0.6, k: 1 - (t - 0.5) * 2 * (1 - kMin) };
}

// ATS software turns emojis and pictographs into junk characters, so the printed resume leaves them out.
const PICTO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
const clean = (s: string) => s.replace(PICTO, "").replace(/[ \t]{2,}/g, " ").replace(/ +$/gm, "").trim();
/** The profile as printed: every text field without emojis. */
export function scrub<T>(v: T): T {
  if (typeof v === "string") return clean(v) as T;
  if (Array.isArray(v)) return v.map(scrub) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) as T;
  return v;
}

const pretty = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
const sp = (pt: number, unit = "pt") => `calc(${pt}${unit} * var(--s))`; // spacing that shrinks to fit
const tx = (pt: number) => `calc(${pt}pt * var(--k))`; // text that shrinks to fit

/** What actually appears on the page (sections and entries after the user's switches and the limits). */
export function visibleContent(p: Profile, o: ResumeOptions, lim: Limits = NO_LIMITS) {
  const cut = (text: string, n: number) => lines(text).slice(0, n);
  return {
    summary: o.showSummary && lim.summary ? p.summary.trim() : "",
    experience: p.experience.filter((x) => x.company || x.role).slice(0, lim.experience).map((x) => ({ ...x, points: cut(x.bullets, lim.bullets) })),
    projects: p.projects.filter((x) => x.name).slice(0, lim.projects).map((x) => ({ ...x, points: cut(x.bullets, lim.bullets) })),
    achievements: o.showAchievements ? cut(p.achievements, lim.achievements) : [],
    certifications: o.showCertifications ? cut(p.certifications, lim.certifications) : [],
  };
}

/**
 * One-page, single-column resume with standard headings and real text, so applicant tracking systems can read it.
 * Sizes follow --s (spacing) and --k (text) so the page can be squeezed onto one sheet.
 */
export default function ResumeDoc({ p: raw, o, skills: rawSkills, limits = NO_LIMITS, fit = { s: 1, k: 1 }, id, measure, page }: {
  p: Profile; o: ResumeOptions; skills?: string[]; limits?: Limits; fit?: Density; id?: string;
  measure?: boolean; // hidden copy used to measure height: no fixed page height
  page?: boolean; // the printed sheet: exactly one A4 page
}) {
  const p = scrub(raw);
  const skills = rawSkills && scrub(rawSkills).filter(Boolean);
  const compact = o.template === "compact";
  const modern = o.template === "modern";
  const accent = modern ? o.accent : "#111111";
  const base = BASE_PT[o.template];
  const skillItems = skills ?? skillList(p);
  const v = visibleContent(p, o, limits);
  const contact: { text: string; href?: string }[] = [
    p.email && { text: p.email, href: `mailto:${p.email}` },
    p.phone && { text: p.phone },
    p.location && { text: p.location },
    p.linkedin && { text: pretty(asUrl(p.linkedin)), href: asUrl(p.linkedin) },
    p.github && { text: pretty(asUrl(p.github)), href: asUrl(p.github) },
    p.portfolio && { text: pretty(asUrl(p.portfolio)), href: asUrl(p.portfolio) },
  ].filter(Boolean) as { text: string; href?: string }[];

  const H = ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ color: accent, borderBottom: `1.2px solid ${modern ? accent : "#222"}`, fontSize: tx(compact ? 10 : 10.8), letterSpacing: "0.06em", margin: `${sp(compact ? 7 : 10)} 0 ${sp(compact ? 3 : 4)}`, paddingBottom: "1.5pt", fontWeight: 800, textTransform: "uppercase", fontFamily: "Inter Variable, Arial, sans-serif" }}>
      {children}
    </h2>
  );
  const Bullets = ({ items }: { items: string[] }) =>
    items.length ? (
      <ul style={{ margin: `${sp(2)} 0 0`, paddingLeft: "13pt", listStyle: "disc" }}>
        {items.map((l, i) => <li key={i} style={{ margin: `${sp(1)} 0` }}>{l}</li>)}
      </ul>
    ) : null;
  const Row = ({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "8pt", alignItems: "baseline" }}>
      <div>{left}</div>
      {right && <div style={{ whiteSpace: "nowrap", color: "#444", fontSize: "0.92em" }}>{right}</div>}
    </div>
  );

  return (
    <article
      id={id}
      data-resume-sheet=""
      style={{
        ["--s" as string]: fit.s, ["--k" as string]: fit.k,
        width: "210mm", boxSizing: "border-box", background: "#fff", color: "#111",
        ...(measure ? {} : page ? { height: "296mm", overflow: "hidden" } : { minHeight: "297mm" }),
        padding: `${sp(compact ? 10 : 13, "mm")} calc(${compact ? 12 : 15}mm * (0.6 + 0.4 * var(--s)))`,
        fontSize: tx(base), lineHeight: "calc(1.25 + 0.13 * var(--s))",
        fontFamily: "Inter Variable, Arial, Helvetica, sans-serif", fontVariantLigatures: "none", // "fi" stays two letters for ATS
        borderTop: modern ? `5pt solid ${accent}` : undefined,
      }}
    >
      <header style={{ textAlign: modern ? "left" : "center", marginBottom: sp(4) }}>
        <h1 style={{ fontSize: tx(compact ? 19 : 22), fontWeight: 800, color: modern ? accent : "#111", margin: 0, letterSpacing: "-0.01em", lineHeight: 1.15 }}>{p.name || "Your Name"}</h1>
        {p.headline && <p style={{ margin: `${sp(1)} 0 0`, fontWeight: 600, color: "#333" }}>{p.headline}</p>}
        {contact.length > 0 && (
          <p style={{ margin: `${sp(3)} 0 0`, color: "#333", fontSize: "0.93em" }}>
            {contact.map((c, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: "#999" }}> | </span>}
                {c.href ? <a href={c.href} style={{ color: "inherit", textDecoration: "none" }}>{c.text}</a> : c.text}
              </span>
            ))}
          </p>
        )}
      </header>

      {v.summary && (<><H>Summary</H><p style={{ margin: 0 }}>{v.summary}</p></>)}

      {(p.college || p.education.length > 0) && (
        <>
          <H>Education</H>
          {p.college && (
            <div style={{ breakInside: "avoid", marginBottom: sp(3) }}>
              <Row left={<b>{p.college}</b>} right={p.batch && `Graduating ${p.batch}`} />
              <Row left={<span>{p.degree}</span>} right={p.cgpa && `CGPA: ${p.cgpa}`} />
            </div>
          )}
          {p.education.filter((e) => e.school || e.degree).map((e, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: sp(2) }}>
              <Row left={<><b>{e.degree}</b>{e.school && `, ${e.school}`}</>} right={[e.score, e.year].filter(Boolean).join(" · ")} />
            </div>
          ))}
        </>
      )}

      {skillItems.length > 0 && (<><H>Skills</H><p style={{ margin: 0 }}>{skillItems.join(", ")}</p></>)}

      {v.experience.length > 0 && (
        <>
          <H>Experience</H>
          {v.experience.map((x, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: sp(5) }}>
              <Row left={<><b>{x.role}</b>{x.company && <>, {x.company}</>}</>} right={[x.start, x.end].filter(Boolean).join(" – ")} />
              {x.location && <div style={{ color: "#555", fontSize: "0.92em" }}>{x.location}</div>}
              <Bullets items={x.points} />
            </div>
          ))}
        </>
      )}

      {v.projects.length > 0 && (
        <>
          <H>Projects</H>
          {v.projects.map((x, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: sp(5) }}>
              <Row
                left={<><b>{x.name}</b>{x.tech && <span style={{ color: "#444" }}> | {x.tech}</span>}</>}
                right={x.link && <a href={asUrl(x.link)} style={{ color: "inherit" }}>{pretty(asUrl(x.link))}</a>}
              />
              <Bullets items={x.points} />
            </div>
          ))}
        </>
      )}

      {v.achievements.length > 0 && (<><H>Achievements</H><Bullets items={v.achievements} /></>)}
      {v.certifications.length > 0 && (<><H>Certifications</H><Bullets items={v.certifications} /></>)}
    </article>
  );
}
