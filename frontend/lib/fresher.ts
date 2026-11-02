import type { Job } from "./jobs";

/** Fresher-friendly job posts, by rules (no AI). */
const SAYS_FRESHER = /\b(freshers?|entry[- ]level|no (?:prior )?experience(?: required| needed)?|new grads?|recent graduates?)\b/i;
const FRESH_HINT = /\b(trainees?|internships?|interns?|off[- ]?campus|campus (?:drive|hiring|placement)|batch(?:es)?|pass ?outs?|passing year|graduat\w*|apprentice\w*)\b/i;
const GET = /\bGET\b/; // Graduate Engineer Trainee (capitals only: "get" is everywhere)
const NOT_FOR_FRESHERS = /\bfreshers?\s+(?:are\s+)?(?:not|can'?t|cannot|need not)\b/i;
const SENIOR = /\b(senior|sr\.|lead|principal|staff engineer|manager|head of|director|architect|vp)\b/i;
// "2+ years of experience", "Experience: 3-5 yrs", "min 2 years exp"
const EXP = /(?:exp(?:erience)?\s*[:\-–]?\s*(?:of\s*)?(?:min(?:imum)?\.?\s*)?(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:yrs?|years?))|(?:(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:yrs?|years?)\s*(?:of\s*)?(?:relevant\s+|work\s+|industry\s+|total\s+)?(?:exp|experience))/gi;
const RANGE_FROM_ZERO = /\b0\s*(?:-|–|to)\s*\d{1,2}\s*\+?\s*(?:yrs?|years?)\b/i;

export function isFresherText(text: string): boolean {
  if (NOT_FOR_FRESHERS.test(text)) return false;
  const mins = [...text.matchAll(EXP)].map((m) => Number(m[1] ?? m[2]));
  const minExp = mins.length ? Math.min(...mins) : null;
  if (SAYS_FRESHER.test(text) || RANGE_FROM_ZERO.test(text) || minExp === 0) return true;
  const experienced = (minExp !== null && minExp >= 2) || SENIOR.test(text);
  return (FRESH_HINT.test(text) || GET.test(text)) && !experienced;
}

const cache = new Map<string, boolean>();
export function isFresherJob(j: Job): boolean {
  let v = cache.get(j.id);
  if (v === undefined) {
    v = isFresherText(`${j.role ?? ""}\n${j.text}`);
    cache.set(j.id, v);
  }
  return v;
}
