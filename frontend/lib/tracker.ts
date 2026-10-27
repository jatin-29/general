import { loadJSON, saveJSON } from "./store";

export type Status = "" | "saved" | "applied" | "referral" | "interview" | "offer" | "rejected";
export const STATUSES: { value: Status; label: string; tone: string }[] = [
  { value: "", label: "Not applied", tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  { value: "saved", label: "⭐ Saved", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  { value: "applied", label: "✅ Applied", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  { value: "referral", label: "🤝 Referral asked", tone: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  { value: "interview", label: "🎤 Interview", tone: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  { value: "offer", label: "🎉 Offer", tone: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300" },
  { value: "rejected", label: "✖ Rejected", tone: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
];
export const ACTIVE: Status[] = ["applied", "referral", "interview", "offer"];
export const DONE_APPLYING: Status[] = ["applied", "referral", "interview", "offer", "rejected"];

export interface Track {
  status: Status;
  note: string;
  followUp: string; // YYYY-MM-DD, "" if none
  appliedOn: string; // YYYY-MM-DD
  updated: number;
}
export type Tracker = Record<string, Track>;

const KEY = "tracker_v1";
export const emptyTrack = (): Track => ({ status: "", note: "", followUp: "", appliedOn: "", updated: 0 });

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return today(new Date(y, m - 1, d + n));
};

export function loadTracker(): Tracker {
  const t = loadJSON<Tracker>(KEY, {});
  // one-time move from the old "Applied" ticks
  const old = loadJSON<string[]>("jobs_applied", []);
  if (old.length) {
    for (const id of old) if (!t[id]) t[id] = { ...emptyTrack(), status: "applied", updated: Date.now() };
    saveJSON(KEY, t);
    try {
      localStorage.removeItem("jobs_applied");
    } catch {}
  }
  return t;
}
export const saveTracker = (t: Tracker) => saveJSON(KEY, t);

/** Changing status fills in sensible dates: applied today, follow up in 6 days. */
export function withStatus(prev: Track | undefined, status: Status): Track {
  const t = { ...(prev ?? emptyTrack()), status, updated: Date.now() };
  if ((status === "applied" || status === "referral") && !t.appliedOn) t.appliedOn = today();
  if ((status === "applied" || status === "referral") && !t.followUp) t.followUp = addDays(today(), 6);
  if (status === "offer" || status === "rejected" || status === "") t.followUp = "";
  return t;
}

export function followUpBadge(t: Track | undefined): { label: string; urgent: boolean } | null {
  if (!t?.followUp || !ACTIVE.includes(t.status)) return null;
  const [y, m, d] = t.followUp.split("-").map(Number);
  const now = new Date();
  const diff = Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  if (diff < 0) return { label: "Follow-up overdue", urgent: true };
  if (diff === 0) return { label: "Follow up today", urgent: true };
  return { label: `Follow up in ${diff}d`, urgent: false };
}
