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

const pretty = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

/** One-page, single-column resume with standard headings and real text, so applicant tracking systems can read it. */
export default function ResumeDoc({ p, o, skills }: { p: Profile; o: ResumeOptions; skills?: string[] }) {
  const compact = o.template === "compact";
  const modern = o.template === "modern";
  const accent = modern ? o.accent : "#111111";
  const base = compact ? "9.4pt" : "10.2pt";
  const skillItems = skills ?? skillList(p);
  const contact: { text: string; href?: string }[] = [
    p.email && { text: p.email, href: `mailto:${p.email}` },
    p.phone && { text: p.phone },
    p.location && { text: p.location },
    p.linkedin && { text: pretty(asUrl(p.linkedin)), href: asUrl(p.linkedin) },
    p.github && { text: pretty(asUrl(p.github)), href: asUrl(p.github) },
    p.portfolio && { text: pretty(asUrl(p.portfolio)), href: asUrl(p.portfolio) },
  ].filter(Boolean) as { text: string; href?: string }[];

  const H = ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ color: accent, borderBottom: `1.2px solid ${modern ? accent : "#222"}`, fontSize: compact ? "10pt" : "10.8pt", letterSpacing: "0.06em", margin: compact ? "7pt 0 3pt" : "10pt 0 4pt", paddingBottom: "1.5pt", fontWeight: 800, textTransform: "uppercase", fontFamily: "Inter Variable, Arial, sans-serif" }}>
      {children}
    </h2>
  );
  const Bullets = ({ text }: { text: string }) =>
    lines(text).length ? (
      <ul style={{ margin: "2pt 0 0", paddingLeft: "13pt", listStyle: "disc" }}>
        {lines(text).map((l, i) => <li key={i} style={{ margin: "1pt 0" }}>{l}</li>)}
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
      id="resume-sheet"
      style={{
        width: "210mm", minHeight: "297mm", background: "#fff", color: "#111", boxSizing: "border-box",
        padding: compact ? "10mm 12mm" : "13mm 15mm", fontSize: base, lineHeight: 1.38,
        fontFamily: "Inter Variable, Arial, Helvetica, sans-serif", borderTop: modern ? `5pt solid ${accent}` : undefined,
      }}
    >
      <header style={{ textAlign: modern ? "left" : "center", marginBottom: "4pt" }}>
        <h1 style={{ fontSize: compact ? "19pt" : "22pt", fontWeight: 800, color: modern ? accent : "#111", margin: 0, letterSpacing: "-0.01em" }}>{p.name || "Your Name"}</h1>
        {p.headline && <p style={{ margin: "1pt 0 0", fontWeight: 600, color: "#333" }}>{p.headline}</p>}
        {contact.length > 0 && (
          <p style={{ margin: "3pt 0 0", color: "#333", fontSize: "0.93em" }}>
            {contact.map((c, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: "#999" }}> | </span>}
                {c.href ? <a href={c.href} style={{ color: "inherit", textDecoration: "none" }}>{c.text}</a> : c.text}
              </span>
            ))}
          </p>
        )}
      </header>

      {o.showSummary && p.summary.trim() && (<><H>Summary</H><p style={{ margin: 0 }}>{p.summary.trim()}</p></>)}

      {(p.college || p.education.length > 0) && (
        <>
          <H>Education</H>
          {p.college && (
            <div style={{ breakInside: "avoid", marginBottom: "3pt" }}>
              <Row left={<b>{p.college}</b>} right={p.batch && `Graduating ${p.batch}`} />
              <Row left={<span>{p.degree}</span>} right={p.cgpa && `CGPA: ${p.cgpa}`} />
            </div>
          )}
          {p.education.filter((e) => e.school || e.degree).map((e, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: "2pt" }}>
              <Row left={<><b>{e.degree}</b>{e.school && `, ${e.school}`}</>} right={[e.score, e.year].filter(Boolean).join(" · ")} />
            </div>
          ))}
        </>
      )}

      {skillItems.length > 0 && (<><H>Skills</H><p style={{ margin: 0 }}>{skillItems.join(", ")}</p></>)}

      {p.experience.some((x) => x.company || x.role) && (
        <>
          <H>Experience</H>
          {p.experience.filter((x) => x.company || x.role).map((x, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: "5pt" }}>
              <Row left={<><b>{x.role}</b>{x.company && <>, {x.company}</>}</>} right={[x.start, x.end].filter(Boolean).join(" – ")} />
              {x.location && <div style={{ color: "#555", fontSize: "0.92em" }}>{x.location}</div>}
              <Bullets text={x.bullets} />
            </div>
          ))}
        </>
      )}

      {p.projects.some((x) => x.name) && (
        <>
          <H>Projects</H>
          {p.projects.filter((x) => x.name).map((x, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: "5pt" }}>
              <Row
                left={<><b>{x.name}</b>{x.tech && <span style={{ color: "#444" }}> | {x.tech}</span>}</>}
                right={x.link && <a href={asUrl(x.link)} style={{ color: "inherit" }}>{pretty(asUrl(x.link))}</a>}
              />
              <Bullets text={x.bullets} />
            </div>
          ))}
        </>
      )}

      {o.showAchievements && lines(p.achievements).length > 0 && (<><H>Achievements</H><Bullets text={p.achievements} /></>)}
      {o.showCertifications && lines(p.certifications).length > 0 && (<><H>Certifications</H><Bullets text={p.certifications} /></>)}
    </article>
  );
}
