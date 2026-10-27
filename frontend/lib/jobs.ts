import { JOBS_URL } from "./mode";

export interface Job {
  id: string;
  source: string;
  text: string;
  apply_link: string | null;
  post_url: string | null;
  posted_at: string | null;
  added_at: string;
}

export interface JobsFile {
  updated_at: string | null;
  jobs: Job[];
}

export async function fetchJobs(): Promise<JobsFile> {
  let res: Response;
  try {
    res = await fetch(`${JOBS_URL}?t=${Date.now()}`, { cache: "no-store" });
  } catch {
    throw new Error("Could not load jobs. Check your internet connection.");
  }
  if (res.status === 404) return { updated_at: null, jobs: [] }; // no job collected yet
  if (!res.ok) throw new Error(`Could not load jobs (${res.status}).`);
  const data = (await res.json()) as Partial<JobsFile>;
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
