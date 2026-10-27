import type { Opening, OpeningDetail, OpeningFilters, OpeningList, Source } from "./api";

/** Demo mode (no backend): sample openings so a static deploy is explorable. Applied state is kept in localStorage. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "true";

const day = (offset: number | null) => {
  if (offset === null) return null;
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const SAMPLES: [string, string, string, Opening["employment_type"], number | null, Opening["source_type"], string, string | null][] = [
  ["Acme Technologies", "Software Engineer Intern", "Remote", "internship", 3, "telegram", "offcampus_jobs", "2026 batch, BE/BTech CS/IT"],
  ["Globex", "Backend Engineer", "Bengaluru", "full-time", 20, "youtube", "Placement Guide", "0-2 years"],
  ["Initech", "QA Engineer (Contract)", "Pune", "contract", null, "telegram", "dev_openings", "Any graduate"],
  ["Umbrella Labs", "Data Analyst Intern", "Hyderabad", "internship", 6, "telegram", "offcampus_jobs", "Pursuing or completed any degree"],
  ["Hooli", "Frontend Developer", "Remote", "full-time", 12, "telegram", "dev_openings", "1+ year React/TypeScript"],
  ["Stark Industries", "ML Research Intern", "Mumbai", "internship", 1, "telegram", "dev_openings", "2025/2026 batch, strong Python"],
  ["Wayne Enterprises", "DevOps Engineer", "Chennai", "full-time", 30, "youtube", "Placement Guide", "2-4 years, AWS"],
  ["Legacy Co", "Support Engineer", "Delhi", "full-time", -5, "telegram", "offcampus_jobs", null],
];

const ALL: OpeningDetail[] = SAMPLES.map(([company, role, location, type, dl, st, sn, el], i) => ({
  id: i + 1,
  company,
  role,
  location,
  employment_type: type,
  eligibility: el,
  deadline: day(dl),
  apply_link: company === "Initech" ? null : `https://example.com/careers/${company.toLowerCase().replace(/\W+/g, "-")}`,
  source_type: st,
  source_name: sn,
  created_at: new Date(Date.now() - i * 3_600_000 * 5).toISOString().slice(0, 19),
  is_expired: dl !== null && dl < 0,
  applied: false,
  raw_text: `${company} is hiring!\n\nRole: ${role}\nLocation: ${location}\n${el ? `Eligibility: ${el}\n` : ""}\n(Sample data shown in demo mode.)`,
  source_url: null,
}));

function appliedSet(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem("demo_applied") ?? "[]"));
  } catch {
    return new Set();
  }
}

const withApplied = <T extends Opening>(o: T): T => ({ ...o, applied: appliedSet().has(o.id) });

export function demoOpenings(f: OpeningFilters): OpeningList {
  const q = (f.search ?? "").toLowerCase();
  const loc = (f.location ?? "").toLowerCase();
  let rows = ALL.map(withApplied).filter(
    (o) =>
      (!f.source || o.source_type === f.source || o.source_name === f.source) &&
      (!f.type || o.employment_type === f.type) &&
      (!loc || (o.location ?? "").toLowerCase().includes(loc)) &&
      (!q || [o.company, o.role, o.eligibility ?? ""].some((s) => s.toLowerCase().includes(q))) &&
      (!f.active_only || !o.is_expired) &&
      (!f.hide_applied || !o.applied),
  );
  const limit = f.limit ?? 20;
  const page = f.page ?? 1;
  return { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
}

export function demoOpening(id: number): OpeningDetail | undefined {
  const o = ALL.find((x) => x.id === id);
  return o && withApplied(o);
}

export function demoSetApplied(id: number, applied: boolean): Opening {
  const s = appliedSet();
  applied ? s.add(id) : s.delete(id);
  try {
    localStorage.setItem("demo_applied", JSON.stringify([...s]));
  } catch {}
  return demoOpening(id)!;
}

export const demoSources = (): Source[] => [
  { id: 1, type: "telegram", identifier: "offcampus_jobs", enabled: true, last_checked_at: null },
  { id: 2, type: "telegram", identifier: "dev_openings", enabled: true, last_checked_at: null },
  { id: 3, type: "youtube", identifier: "UC_sample_channel_id", enabled: false, last_checked_at: null },
];
