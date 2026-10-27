import { decryptEnvelope, type Envelope } from "./crypto";
import { JOBS_API_URL, JOBS_URL } from "./mode";

export interface Job {
  id: string;
  source: string;
  text: string;
  apply_link: string | null;
  post_url: string | null;
  posted_at: string | null;
  added_at: string;
  // Only on jobs you add yourself with the + button (kept in this browser):
  company?: string | null;
  role?: string | null;
  deadline?: string | null; // YYYY-MM-DD
  manual?: boolean;
}

/** "2026-11-05" as a local date (new Date("2026-11-05") would be UTC and can shift a day). */
export function parseIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export interface JobsFile {
  updated_at: string | null;
  jobs: Job[];
}

export class PasswordRequired extends Error {}
export class WrongPassword extends Error {}

/** Plain jobs.json, or the encrypted one (needs the password you set as SITE_PASSWORD). */
export async function fetchJobs(password = ""): Promise<JobsFile> {
  let res: Response | null = null;
  if (JOBS_API_URL) {
    try {
      // "raw" media type returns the file itself; the API allows about 60 requests an hour per visitor
      const r = await fetch(JOBS_API_URL, { cache: "no-store", headers: { Accept: "application/vnd.github.raw+json" } });
      if (r.ok || r.status === 404) res = r;
    } catch {}
  }
  if (!res) {
    try {
      res = await fetch(`${JOBS_URL}?t=${Date.now()}`, { cache: "no-store" });
    } catch {
      throw new Error("Could not load jobs. Check your internet connection.");
    }
  }
  if (res.status === 404) return { updated_at: null, jobs: [] }; // no job collected yet
  if (!res.ok) throw new Error(`Could not load jobs (${res.status}).`);
  let data = (await res.json()) as Partial<JobsFile> & Partial<Envelope>;
  if (data.v) {
    if (!password) throw new PasswordRequired();
    try {
      const inner = await decryptEnvelope<JobsFile>(data as Envelope, password);
      data = { ...inner, updated_at: inner.updated_at ?? data.updated_at };
    } catch {
      throw new WrongPassword();
    }
  }
  return { updated_at: data.updated_at ?? null, jobs: data.jobs ?? [] };
}

/** First non-empty line, tidied, used as the card title. */
export function jobTitle(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "Job opening";
  const clean = line.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return (clean || "Job opening").slice(0, 110);
}

/** Everything after the title line. */
export function jobBody(text: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim().length > 0);
  return lines.slice(i + 1).join("\n").trim();
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 7 * 86400) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
