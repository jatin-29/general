/** Pulls company, role and deadline out of a free-form job post. Pattern-based (no AI), so any field can be null. */
export interface Parsed {
  company: string | null;
  role: string | null;
  deadline: Date | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DEADLINE_LABEL =
  "(?:last\\s*date(?:\\s*to\\s*apply)?|last\\s*day|deadline|apply\\s*(?:by|before|till|until)|closing\\s*date|closes?(?:\\s*on)?|valid\\s*(?:till|until)|registration\\s*(?:ends?|closes?)(?:\\s*on)?|due\\s*date)";

const NAMED_DATE = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./,]*(?:of\\s+)?${MONTH_RE}[a-z]*\\.?(?:[\\s\\-./,]+(\\d{2,4}))?`, "i");
const MONTH_FIRST = new RegExp(`${MONTH_RE}[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i");
const NUMERIC_DATE = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/;

const ROLE_WORDS =
  /\b(engineer|developer|intern|interns|internship|analyst|manager|trainee|associate|executive|designer|tester|scientist|consultant|specialist|officer|architect|administrator|support|sde|qa|hr|programmer|lead|fresher|apprentice|assistant)\b/i;

function cleanLine(s: string): string {
  return s
    .replace(/[*_`~#>]+/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "") // leading emojis, bullets, arrows
    .replace(/\s+/g, " ")
    .trim();
}

function tidy(s: string | undefined | null, max = 70): string | null {
  if (!s) return null;
  let v = cleanLine(s)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*[\(\[].*$/, "") // trailing (batch, location) notes
    .split(/\s+[|\-–—]\s+|\s*[!:]\s|\s+apply\b/i)[0]
    .replace(/^(for|as|the)\s+/i, "")
    .replace(/[\s.,;:!\-–]+$/, "")
    .trim();
  if (v.length < 2 || v.length > max || /^\d+$/.test(v)) return null;
  return v;
}

function toDate(d: number, m: number, y: number | null, now: Date): Date | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let year = y;
  if (year === null) {
    year = today.getFullYear();
    // no year given: choose the occurrence that makes sense (not more than ~2 months in the past)
    if (new Date(year, m, d).getTime() < today.getTime() - 60 * 86400000) year += 1;
  } else if (year < 100) year += 2000;
  const date = new Date(year, m, d);
  return date.getMonth() === m ? date : null; // rejects 31 Feb etc.
}

function findDate(text: string, now: Date): Date | null {
  let m = NAMED_DATE.exec(text);
  if (m) {
    const r = toDate(+m[1], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), m[3] ? +m[3] : null, now);
    if (r) return r;
  }
  m = MONTH_FIRST.exec(text);
  if (m) {
    const r = toDate(+m[2], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), m[3] ? +m[3] : null, now);
    if (r) return r;
  }
  m = NUMERIC_DATE.exec(text);
  if (m) {
    let [d, mo] = [+m[1], +m[2]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // MM/DD/YYYY
    return toDate(d, mo - 1, +m[3], now);
  }
  return null;
}

function parseDeadline(text: string, now: Date): Date | null {
  const labelled = new RegExp(`${DEADLINE_LABEL}\\s*(?:is|on|[:\\-–=])?\\s*([^\\n]{0,60})`, "i");
  const m = labelled.exec(text);
  return m ? findDate(m[1], now) : null;
}

function labelled(text: string, labels: string): string | null {
  const m = new RegExp(`^[^\\p{L}\\p{N}]*(?:${labels})\\s*[:\\-–=]\\s*(.+)$`, "imu").exec(text);
  return m ? tidy(m[1]) : null;
}

const roleOk = (r: string | null) => (r && ROLE_WORDS.test(r) ? r : null); // "freshers 2026" is not a role

function fromHeadline(line: string): { company: string | null; role: string | null } {
  const l = cleanLine(line).replace(/https?:\/\/\S+/g, "").trim();
  let m = /^(.{2,60}?)\s+(?:is|are)\s+(?:currently\s+|now\s+)?(?:hiring|recruiting|looking\s+for)\s*(?:for\s+)?(?:an?\s+)?(.{3,90})$/i.exec(l);
  if (m) return { company: tidy(m[1], 60), role: roleOk(tidy(m[2])) };
  m = /^(.{2,60}?)\s+(?:hiring|recruiting)\s*(?:for\s+)?(?:an?\s+)?(.{3,90})$/i.exec(l);
  if (m) return { company: tidy(m[1], 60), role: roleOk(tidy(m[2])) };
  m = /^(.{2,60}?)\s+(?:off[\s-]?campus|walk[\s-]?in|recruitment|hiring)\b[^|]*\|\s*(.{3,90})$/i.exec(l);
  if (m) return { company: tidy(m[1], 60), role: roleOk(tidy(m[2])) };
  m = /^(.{3,90}?)\s+(?:at|@)\s+(.{2,60})$/i.exec(l);
  if (m && ROLE_WORDS.test(m[1])) return { company: tidy(m[2], 60), role: tidy(m[1]) };
  return { company: null, role: null };
}

export function parseJob(text: string, now = new Date()): Parsed {
  let company = labelled(text, "company(?:\\s*name)?|organi[sz]ation|employer|hiring\\s*company|firm");
  let role = labelled(text, "role|position|post(?:\\s*name)?|job\\s*title|job\\s*role|designation|profile|hiring\\s*for");
  if (!company || !role) {
    const first = text.split("\n").map((l) => l.trim()).find((l) => cleanLine(l).length > 3) ?? "";
    const h = fromHeadline(first);
    company = company ?? h.company;
    role = role ?? h.role;
  }
  return { company, role, deadline: parseDeadline(text, now) };
}

/** Whole days from today (local) to the deadline. Negative = already passed. */
export function daysLeft(deadline: Date, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((deadline.getTime() - today.getTime()) / 86400000);
}

export function deadlineBadge(deadline: Date, now = new Date()): { label: string; tone: "urgent" | "soon" | "ok" | "expired" } {
  const d = daysLeft(deadline, now);
  const when = deadline.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (d < 0) return { label: `Expired · ${when}`, tone: "expired" };
  if (d === 0) return { label: `Closing today · ${when}`, tone: "urgent" };
  if (d === 1) return { label: `Closing tomorrow · ${when}`, tone: "urgent" };
  return { label: `Closing in ${d} days · ${when}`, tone: d <= 3 ? "urgent" : d <= 7 ? "soon" : "ok" };
}
