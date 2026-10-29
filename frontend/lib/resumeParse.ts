import type { Education, Experience, Profile, Project } from "./profile";
import type { ResumeText } from "./resumeFile";

/** What a resume can fill on "My profile". Rules only (no AI): you review everything before it's used. */
export type ParsedResume = Partial<Pick<Profile,
  "name" | "email" | "phone" | "location" | "headline" | "summary" | "college" | "degree" | "batch" | "cgpa" | "skills" |
  "linkedin" | "github" | "portfolio" | "achievements" | "certifications" | "experience" | "projects" | "education">>;

type Section = "header" | "summary" | "education" | "experience" | "projects" | "skills" | "achievements" | "certifications" | "other";

const SECTIONS: [Exclude<Section, "header">, RegExp][] = [
  ["summary", /^((professional|career) )?(summary|objective|profile|about( me)?)$|^career (objective|summary)$/],
  ["education", /^(education(al)?|academic(s)?|qualifications?|scholastic)( (details|qualifications?|background|profile|record))?$/],
  ["experience", /^((work|professional|industry|relevant|industrial) )?(experience|internships?|employment( history)?|work history|training)( (and|&) (internships?|trainings?))?$|^internships?( experience)?$/],
  ["projects", /^((academic|personal|key|major|technical|selected|other|notable) )?projects?( (and|&) \w+)?$/],
  ["skills", /^((technical|key|core|relevant|professional|it) )?(skills?|competenc(ies|y)|technolog(ies|y)|tech stack|tools)( (and|&) \w+)?$/],
  ["achievements", /^(achievements?|awards?|honou?rs?|accomplishments?|extra ?curricular( activities)?|co ?curricular( activities)?|positions? of responsibility|leadership( experience)?|activities|competitive programming|coding profiles)( (and|&) \w+)?$/],
  ["certifications", /^(certifications?|certificates?|courses?|licenses?|trainings?)( (and|&) (certifications?|courses?|trainings?))?$/],
  ["other", /^(hobbies|interests|languages( known)?|declaration|personal (details|information|profile)|references?|contact( details)?|strengths|publications?|soft skills)( (and|&) \w+)?$/],
];
// "Skills: Python, Java" on one line starts the skills section (only for clear headings, so "Tech: React" inside a project doesn't).
const STRONG = /^((technical|key|core) )?skills$|^education$|^projects$|^(work )?experience$|^achievements$|^certifications$|^(career )?objective$|^summary$/;

const MONTH = "\\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?(?![a-z])";
const DATE = `(?:${MONTH}\\s*'?,?\\s*(?:19|20)?\\d{2}|\\d{1,2}[/.-](?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|till)\\s*(${DATE}|present|current|now|till date|ongoing|date)`, "i");
const LONE_DATE = new RegExp(`\\(?(?:expected\\s*:?\\s*)?${DATE}\\)?`, "gi");
const YEAR = /\b(?:19|20)\d{2}\b/g;
const BULLET = /^(?:•|[-–*>]|\d{1,2}[.)])\s+/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]{2,}(?:\.[a-z0-9-]+)*\.(?:com|in|io|dev|me|app|org|net|co|ai|xyz|site|page|vercel\.app|netlify\.app|github\.io)(?:\/[^\s|,;)]*)?/gi;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const EMAILS = new RegExp(EMAIL.source, "gi");

const CITIES = "delhi|new delhi|mumbai|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|noida|greater noida|gurgaon|gurugram|ahmedabad|jaipur|lucknow|chandigarh|mohali|indore|bhopal|kochi|coimbatore|nagpur|patna|faridabad|ghaziabad|dehradun|surat|vadodara|visakhapatnam|vizag|bhubaneswar|mysore|mysuru|thiruvananthapuram|trivandrum|ranchi|guwahati|kanpur|ludhiana|amritsar|agra|varanasi|meerut|jalandhar|rohtak|karnal|panipat|sonipat|hisar|ambala|kota|jodhpur|udaipur|raipur|vellore|manipal|warangal|kurukshetra|remote";
const CITY = new RegExp(`^(${CITIES})$`, "i");

const INSTITUTE = /(universit|institute|college|\biit\b|\bnit\b|\biiit\b|\bbits\b|vidyalaya|vidyapeeth|vidyapith|school|academy|polytechnic|campus)/i;
const COLLEGE_DEG = /\b(b\.? ?tech|b\.? ?e\.?\b|bachelor|m\.? ?tech|master|b\.? ?sc|m\.? ?sc|bca|mca|bba|mba|b\.? ?com|m\.? ?com|b\.? ?a\.?\b|m\.? ?a\.?\b|diploma|ph\.? ?d|integrated|dual degree|pgdm)/i;
const SCHOOL_DEG = /\b((class|std\.?|grade)\s*(x|xii|10|12)(th)?|xii|x|10th|12th|ssc|hsc|intermediate|senior secondary|higher secondary|secondary( school)?|matric\w*|aissce|aisse|isc|icse)\b/i;
const BOARD = /\b(cbse|icse|isc|igcse|ib|nios|state board|[a-z]+ board)\b/i;
const ROLE = /\b(intern(ship)?|engineer|developer|analyst|associate|manager|designer|consultant|trainee|lead|scientist|executive|assistant|specialist|fellow|volunteer|member|coordinator|researcher|administrator|architect|programmer|tester|head|president|secretary|representative|ambassador|mentor|tutor|sde|swe)\b/i;

const VERB = /^(built|developed|designed|implemented|created|led|wrote|worked|managed|improved|reduced|increased|automated|collaborated|analy[sz]ed|deployed|integrated|optimi[sz]ed|conducted|researched|trained|achieved|delivered|maintained|tested|migrated|architected|spearheaded|coordinated|organi[sz]ed|handled|prepared|assisted|cleaned|cut|used|added|made|helped|launched|engineered|contributed|enhanced|streamlined|established|mentored|owned|shipped|refactored|scaled|set up|wrote|won|secured|ranked|participated|volunteered|completed|learned|studied|performed|supported|resolved|generated|identified|presented|published|collected|aggregates|collects)\b/i;
const title = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
const tidy = (s: string) => s.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/^[\s,;:|–—)-]+|[\s,;:|–—(-]+$/g, "").trim();
const unbullet = (s: string) => s.replace(BULLET, "").trim();
const chunks = (s: string) => s.split(/\s{3,}|\s*\|\s*|\s+[•·◦]\s+/).map(tidy).filter(Boolean);
const shortUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");

/** Which section a heading line starts, if it is one. */
function heading(line: string): Exclude<Section, "header"> | null {
  let l = line.trim();
  if (/^([A-Z] ){3,}[A-Z]$/.test(l)) l = l.replace(/ /g, ""); // "E D U C A T I O N"
  if (l.length > 48 || /[.,;]$/.test(l)) return null;
  const t = l.replace(/[^A-Za-z&/ ]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!t || t.split(" ").length > 5) return null;
  for (const [s, re] of SECTIONS) if (re.test(t)) return s;
  return null;
}

function splitSections(lines: string[]) {
  const parts: Record<Section, string[]> = { header: [], summary: [], education: [], experience: [], projects: [], skills: [], achievements: [], certifications: [], other: [] };
  let cur: Section = "header";
  for (const line of lines) {
    const h = heading(line);
    if (h) { cur = h; continue; }
    const m = line.match(/^([A-Za-z][A-Za-z &/]{2,30}):\s*(.+)$/);
    if (m && STRONG.test(m[1].trim().toLowerCase())) {
      cur = heading(m[1]) ?? cur;
      parts[cur].push(m[2]);
      continue;
    }
    parts[cur].push(line);
  }
  return parts;
}

// ------------------------------------------------------------------ contact details
function findPhone(lines: string[]) {
  for (const l of lines) {
    for (const m of l.matchAll(/\+?\(?\d[\d\s().-]{8,17}\d/g)) {
      const raw = m[0].trim();
      const d = raw.replace(/\D/g, "");
      if (/^(19|20)\d{2}\D+(19|20)\d{2}/.test(raw)) continue; // "2022 - 2026"
      if ((d.length === 10 && /^[6-9]/.test(d)) || (d.length === 12 && d.startsWith("91")) || (raw.startsWith("+") && d.length >= 10 && d.length <= 13)) return raw;
    }
  }
  return "";
}

function findName(header: string[]) {
  for (const line of header.slice(0, 6)) {
    const first = chunks(line)[0] ?? "";
    const t = first.replace(/^name\s*:\s*/i, "");
    if (/resume|curriculum|vitae|\bcv\b|@|\d/i.test(t)) continue;
    const words = t.split(/\s+/);
    if (/^[A-Za-z][A-Za-z.' -]{1,40}$/.test(t) && words.length >= 1 && words.length <= 4 && !heading(t)) return title(t);
  }
  return "";
}

function findLocation(header: string[]) {
  for (const line of header) {
    for (const c of line.split(/\s{3,}|\s*[|•·◦]\s*/).map((s) => s.replace(/^[^A-Za-z]+/, "").trim())) {
      if (!c || EMAIL.test(c) || /\d{4,}|https?:|\.com|linkedin|github/i.test(c) || INSTITUTE.test(c) || COLLEGE_DEG.test(c)) continue;
      const v = c.replace(/^(address|location|city)\s*:?\s*/i, "");
      if (/^[A-Za-z .]{2,30},\s*[A-Za-z .]{2,30}$/.test(v) || CITY.test(v)) return v;
      const bits = v.split(/\s*,\s*/);
      const i = bits.findIndex((b) => CITY.test(b)); // "Sector 15, Rohini, Delhi" → "Delhi"
      if (i >= 0) return bits.slice(i).join(", ");
    }
  }
  return "";
}

function findLinks(text: string, header: string[], links: string[]) {
  const all = [...links, ...(text.replace(EMAILS, " ").match(URL_RE) ?? [])];
  const linkedin = all.find((u) => /linkedin\.com\/in\//i.test(u));
  const gh = all.map((u) => u.match(/github\.com\/([A-Za-z0-9-]+)/i)?.[1]).find((u) => u && !/^(orgs|topics|features|about)$/i.test(u));
  const known = /linkedin|github\.com|leetcode|codechef|codeforces|hackerrank|geeksforgeeks|kaggle|gmail|outlook|yahoo|google\.com|wa\.me|instagram|twitter|x\.com|facebook|medium\.com/i;
  const portfolio = (header.join(" ").replace(EMAILS, " ").match(URL_RE) ?? []).find((u) => !known.test(u));
  return {
    linkedin: linkedin ? shortUrl(linkedin).replace(/[?#].*$/, "") : "",
    github: gh ? `github.com/${gh}` : "",
    portfolio: portfolio ? shortUrl(portfolio) : "",
  };
}

// ------------------------------------------------------------------ education
function score(text: string) {
  const g =
    text.match(/(?:c\.?g\.?p\.?a|s\.?g\.?p\.?a|gpa|cpi)\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)/i) ??
    text.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:\/\s*10\s*)?(?:c\.?g\.?p\.?a|s\.?g\.?p\.?a|gpa|cpi)\b/i) ??
    text.match(/\b(\d{1,2}\.\d{1,2})\s*\/\s*10\b/);
  if (g) return g[1];
  const p = text.match(/(\d{2}(?:\.\d{1,2})?)\s*%/);
  return p ? `${p[1]}%` : "";
}

function stripMeta(s: string) {
  return tidy(
    s.replace(RANGE, " ")
      .replace(LONE_DATE, " ")
      .replace(/(?:c\.?g\.?p\.?a|s\.?g\.?p\.?a|gpa|cpi|percentage|marks|score)\s*[:\-–]?\s*\d{1,2}(?:\.\d{1,2})?(?:\s*\/\s*10)?\s*%?/gi, " ")
      .replace(/\b\d{1,2}(?:\.\d{1,2})?\s*(?:\/\s*10\s*)?(?:c\.?g\.?p\.?a|s\.?g\.?p\.?a|gpa|cpi)\b/gi, " ")
      .replace(/\b\d{1,2}\.\d{1,2}\s*\/\s*10\b|\b\d{2}(?:\.\d{1,2})?\s*%/g, " ")
      .replace(/\b(present|current|ongoing|pursuing|expected)\b/gi, " "),
  );
}

interface EduEntry { school: string; degree: string; year: string; score: string; level: "college" | "school" }

function education(lines: string[]): EduEntry[] {
  const groups: string[][] = [];
  let cur: string[] = [];
  let inst = false;
  let deg = false;
  for (const l of lines.map(unbullet)) {
    const i = INSTITUTE.test(l);
    const d = COLLEGE_DEG.test(l) || /\b(class|std\.?|grade)\s*(x|xii|10|12)|\b(xii|10th|12th|ssc|hsc|intermediate|senior secondary|higher secondary|matric)/i.test(l);
    if (cur.length && ((i && inst) || (d && deg))) { groups.push(cur); cur = []; inst = deg = false; }
    cur.push(l);
    inst ||= i;
    deg ||= d;
  }
  if (cur.length) groups.push(cur);

  return groups.map((g): EduEntry => {
    const text = g.join("   ");
    const parts = g.flatMap(chunks).map(stripMeta).filter(Boolean);
    let school = parts.find((c) => INSTITUTE.test(c) && !COLLEGE_DEG.test(c)) ?? parts.find((c) => INSTITUTE.test(c)) ?? "";
    let degree = parts.find((c) => c !== school && (COLLEGE_DEG.test(c) || SCHOOL_DEG.test(c))) ?? "";
    if (!degree && school && (COLLEGE_DEG.test(school) || SCHOOL_DEG.test(school))) {
      // "B.Tech in CSE, Delhi Technological University" in one piece
      const bits = school.split(/,\s*|\s+(?:at|from)\s+/i);
      school = bits.find((b) => INSTITUTE.test(b) && !COLLEGE_DEG.test(b)) ?? school;
      degree = tidy(bits.filter((b) => b !== school).join(", "));
    }
    const city = school.match(/,\s*([A-Za-z ]+)$/)?.[1];
    if (city && school.toLowerCase().slice(0, -city.length).includes(city.toLowerCase())) school = tidy(school.slice(0, -city.length)); // "DTU Delhi, Delhi"
    const years = (text.match(YEAR) ?? []).map(Number);
    const isSchool = !COLLEGE_DEG.test(`${degree} ${school}`) && SCHOOL_DEG.test(text);
    if (isSchool) {
      const twelfth = /\b(xii|12th|(class|std\.?|grade)\s*12|hsc|intermediate|senior secondary|higher secondary|isc|aissce)\b/i.test(text);
      const board = text.match(BOARD)?.[0];
      degree = `Class ${twelfth ? "XII" : "X"}${board ? ` (${board.length <= 5 ? board.toUpperCase() : board})` : ""}`;
      school = tidy(school.replace(BOARD, ""));
    }
    return { school: tidy(school), degree: tidy(degree.replace(/^(degree|course|qualification)\s*:?\s*/i, "")), year: years.length ? String(Math.max(...years)) : "", score: score(text), level: isSchool ? "school" : "college" };
  }).filter((e) => (e.school || e.degree) && (e.year || e.score || (e.school && e.degree))); // drops a table's header row
}

// ------------------------------------------------------------------ experience and projects
/** Split a section into entries: heading lines (title, company, dates) followed by bullet lines. */
function entries(lines: string[]) {
  const out: { head: string[]; body: string[] }[] = [];
  let cur: { head: string[]; body: string[] } | null = null;
  // A heading has dates, a "Name | Tech" separator, or mostly Capitalised words ("Software Engineer Intern").
  const titleLike = (l: string) => {
    if (RANGE.test(l) || /\s\|\s|\s{3,}/.test(l)) return true;
    if (VERB.test(l)) return false; // "Built a REST API…" is a bullet point even without the bullet
    const long = l.split(/\s+/).filter((w) => w.replace(/\W/g, "").length > 3);
    return l.split(/\s+/).length <= 8 && !/[.;:]$/.test(l) && long.length > 0 && long.filter((w) => /^[A-Z0-9"'(]/.test(w)).length / long.length >= 0.75;
  };
  for (const l of lines) {
    if (BULLET.test(l)) {
      if (!cur) out.push((cur = { head: [], body: [] }));
      cur.body.push(unbullet(l));
      continue;
    }
    const t = titleLike(l);
    if (cur && !cur.body.length && t && cur.head.length < 3 && !(RANGE.test(l) && cur.head.some((h) => RANGE.test(h)))) {
      cur.head.push(l);
      continue;
    }
    if (!cur || t) {
      out.push((cur = t ? { head: [l], body: [] } : { head: [], body: [l] }));
      continue;
    }
    const last = cur.body[cur.body.length - 1];
    if (last !== undefined && !/[.!]$/.test(last) && /^[a-z(&]/.test(l)) cur.body[cur.body.length - 1] = `${last} ${l}`; // wrapped line
    else cur.body.push(l);
  }
  return out;
}

function dates(head: string[]) {
  const m = head.join("   ").match(RANGE);
  if (!m) return { start: "", end: "" };
  const fix = (s: string) => title(tidy(s)).replace(/^(present|current|now|till date|ongoing|date)$/i, "Present");
  return { start: fix(m[1]), end: fix(m[2]) };
}

function experience(lines: string[]): Experience[] {
  return entries(lines).slice(0, 8).map(({ head, body }) => {
    const { start, end } = dates(head);
    const parts = head.flatMap((h) => h.replace(RANGE, "   ").replace(/\(\s*\)/g, "   ").split(/\s{3,}|\s*\|\s*|\s+[–—-]\s+|,\s*|\s+at\s+/)).map(stripMeta).filter(Boolean);
    const isLoc = (p: string) => CITY.test(p) || /\b(remote|on-?site|hybrid|india|work from home|wfh)\b/i.test(p);
    const location = parts.filter((p) => isLoc(p) && !ROLE.test(p));
    const rest = parts.filter((p) => !location.includes(p));
    const role = rest.find((p) => ROLE.test(p)) ?? rest[1] ?? "";
    const company = rest.find((p) => p !== role) ?? "";
    return { company, role, start, end, location: location.join(", "), bullets: body.join("\n") };
  }).filter((x) => x.company || x.role);
}

function projects(lines: string[], links: string[]): Project[] {
  // "1. Smart Attendance System" is a project title here, not a bullet point
  return entries(lines.map((l) => l.replace(/^\d{1,2}[.)]\s+/, ""))).slice(0, 8).map(({ head, body }) => {
    let tech = "";
    const bullets = body.filter((b) => {
      const m = b.match(/^(tech(nolog(y|ies))?( stack| used)?|tools( used)?|built with|stack)\s*[:\-–]\s*(.+)$/i);
      if (m) { tech = tidy(m[5]); return false; }
      return true;
    });
    const line = head.join("   ").replace(RANGE, " ").replace(LONE_DATE, " ");
    const url = (`${line} ${body.join(" ")}`.match(URL_RE) ?? []).find((u) => /github\.com\/[^/\s]+\/|vercel\.app|netlify\.app|github\.io|herokuapp|\.dev|\.app/i.test(u));
    const parts = line.replace(URL_RE, " ").split(/\s{3,}|\s*\|\s*|\s+[–—-]\s+|:\s+/).map(tidy).filter(Boolean);
    const paren = parts[0]?.match(/^(.*?)\s*\(([^)]*,[^)]*)\)\s*$/); // "Job Board (Next.js, Python)"
    const name = tidy((paren ? paren[1] : parts[0] ?? "").replace(/\s*[([]?\b(link|live( demo)?|demo|github|source code)\b[)\]]?\s*$/i, ""));
    if (!tech && !paren && /\s\|\s/.test(line) && parts[1] && parts[1].length <= 80) tech = parts[1]; // "Chess Engine | C++"
    if (!tech) tech = paren ? tidy(paren[2]) : parts.slice(1).find((p) => p.includes(",") || /\b(react|python|java|node|sql|django|flask|next|flutter|html|css|mongo|aws|ml)\b/i.test(p)) ?? "";
    const link = url ?? links.find((l) => name && l.toLowerCase().includes(name.toLowerCase().replace(/\s+/g, "-"))) ?? "";
    return { name, tech: tech.replace(/^(tech(nolog(y|ies))?( stack)?|tools)\s*[:\-–]\s*/i, ""), link: link ? shortUrl(link) : "", bullets: bullets.join("\n") };
  }).filter((p) => p.name);
}

function skills(lines: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    for (const raw of unbullet(line).replace(/^[A-Za-z &/]{2,30}:\s*/, "").split(/\s*[,|•;·]\s*|\s{3,}/)) {
      const s = tidy(raw.replace(/^(and|&)\s+/i, ""));
      if (!s || s.length > 40 || s.split(/\s+/).length > 5 || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.join(", ");
}

const listLines = (lines: string[]) => entries(lines).flatMap((e) => [...e.head, ...e.body]).map(unbullet).filter(Boolean).join("\n");

// ------------------------------------------------------------------ all together
export function parseResume({ lines, links }: ResumeText): ParsedResume {
  const parts = splitSections(lines);
  const header = parts.header.length ? parts.header : lines.slice(0, 6);
  const text = lines.join("\n");
  const out: ParsedResume = {};

  out.name = findName(header);
  out.email = (links.find((l) => l.startsWith("mailto:"))?.slice(7) || text.match(EMAIL)?.[0] || "").trim();
  out.phone = findPhone(header) || findPhone(lines);
  out.location = findLocation(header);
  Object.assign(out, findLinks(text, header, links));
  const after = header.slice(header.findIndex((l) => out.name && l.includes(out.name.split(" ")[0])) + 1);
  out.headline = after.map((l) => chunks(l)[0] ?? "").find((l) => l.length <= 70 && !EMAIL.test(l) && !/\d{5,}|https?:|\.com|linkedin|github/i.test(l) && /\b(student|engineer|developer|analyst|intern|graduate|designer|scientist|enthusiast|fresher|b\.? ?tech|programmer|undergrad)/i.test(l)) ?? "";
  out.summary = parts.summary.map(unbullet).join(" ").slice(0, 700);

  const edu = education(parts.education);
  const main = edu.find((e) => e.level === "college");
  if (main) {
    out.college = main.school;
    out.degree = main.degree;
    out.batch = main.year;
    out.cgpa = main.score;
  }
  out.education = edu.filter((e) => e !== main).map(({ school, degree, year, score: s }): Education => ({ school, degree, year, score: s }));
  out.experience = experience(parts.experience);
  out.projects = projects(parts.projects, links);
  out.skills = skills(parts.skills);
  out.achievements = listLines(parts.achievements);
  out.certifications = listLines(parts.certifications);

  // keep only what was found
  for (const k of Object.keys(out) as (keyof ParsedResume)[]) {
    const v = out[k];
    if (!v || (Array.isArray(v) && !v.length)) delete out[k];
  }
  return out;
}
