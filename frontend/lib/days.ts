import type { Job } from "./jobs";

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-11-01" for a date in your own time zone. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** When the job was posted in its group (or added, for ones without a post time). */
export const jobTime = (j: Job) => Date.parse(j.posted_at ?? j.added_at) || 0;
export const jobDay = (j: Job) => dayKey(new Date(jobTime(j)));

/** "Today", "Yesterday" or "Sun, 1 Nov 2026". */
export function dayLabel(key: string, now = new Date()) {
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return "Yesterday";
  return fromKey(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** "today", "yesterday" or "1 Nov", for short labels. */
export function shortDay(key: string, now = new Date()) {
  const l = dayLabel(key, now);
  return l === "Today" || l === "Yesterday" ? l.toLowerCase() : fromKey(key).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const monthStart = (k: string) => {
  const d = fromKey(k);
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
