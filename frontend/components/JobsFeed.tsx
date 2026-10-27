"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fetchJobs, jobBody, jobTitle, timeAgo, type Job } from "@/lib/jobs";

const PAGE = 30;
const REFRESH_MS = 5 * 60_000;
const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Plain text with clickable links. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part.replace(/[.,;:!?]+$/, "")} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-600 underline dark:text-indigo-400">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function JobCard({ job, isNew, applied, onToggle }: { job: Job; isNew: boolean; applied: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const body = jobBody(job.text);
  const long = body.length > 220 || body.split("\n").length > 4;
  return (
    <article className={`card flex flex-col gap-3 p-4 transition ${applied ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">{job.source}</span>
        {isNew && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">New</span>}
        <span className="text-slate-500">{timeAgo(job.posted_at ?? job.added_at)}</span>
      </div>
      <h2 className="text-base font-semibold leading-snug">{jobTitle(job.text)}</h2>
      {body && (
        <div>
          <p className={`whitespace-pre-line break-words text-sm text-slate-600 dark:text-slate-400 ${open ? "" : "line-clamp-3"}`}>
            <Linkified text={body} />
          </p>
          {long && (
            <button onClick={() => setOpen(!open)} className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {open ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {job.apply_link ? (
          <a href={job.apply_link} target="_blank" rel="noopener noreferrer" className="btn-primary">Apply ↗</a>
        ) : job.post_url ? (
          <a href={job.post_url} target="_blank" rel="noopener noreferrer" className="btn-primary">Open post ↗</a>
        ) : null}
        {job.apply_link && job.post_url && (
          <a href={job.post_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">Original post</a>
        )}
        <label className="ml-auto flex cursor-pointer select-none items-center gap-1.5 text-sm">
          <input type="checkbox" checked={applied} onChange={onToggle} className="h-4 w-4 rounded accent-indigo-600" />
          Applied
        </label>
      </div>
    </article>
  );
}

export default function JobsFeed() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [hideApplied, setHideApplied] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [lastVisit, setLastVisit] = useState<number>(0);
  const [shown, setShown] = useState(PAGE);

  const refresh = useCallback(async () => {
    try {
      const f = await fetchJobs();
      setJobs(f.jobs);
      setUpdatedAt(f.updated_at);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load jobs");
    }
  }, []);

  useEffect(() => {
    setApplied(new Set(load<string[]>("jobs_applied", [])));
    setLastVisit(load<number>("jobs_last_visit", 0));
    const leave = () => save("jobs_last_visit", Date.now()); // "New" = arrived since you last visited
    window.addEventListener("pagehide", leave);
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      clearInterval(id);
    };
  }, [refresh]);

  const toggle = (id: string) =>
    setApplied((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      save("jobs_applied", [...next]);
      return next;
    });

  const sources = useMemo(() => [...new Set((jobs ?? []).map((j) => j.source))].sort(), [jobs]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (jobs ?? []).filter(
      (j) => (!source || j.source === source) && (!hideApplied || !applied.has(j.id)) && (!q || j.text.toLowerCase().includes(q)),
    );
  }, [jobs, search, source, hideApplied, applied]);

  useEffect(() => setShown(PAGE), [search, source, hideApplied]);

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 p-4 sm:grid-cols-[1fr_12rem]">
        <input className="input" type="search" placeholder="Search jobs, companies, skills…" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={hideApplied} onChange={(e) => setHideApplied(e.target.checked)} />
          Hide jobs I applied to
        </label>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{jobs ? `${visible.length} job${visible.length === 1 ? "" : "s"}` : " "}</span>
        <span>
          {updatedAt ? `Updated ${timeAgo(updatedAt)} · ` : ""}
          <button onClick={refresh} className="text-indigo-600 hover:underline dark:text-indigo-400">Refresh</button>
        </span>
      </div>

      {error && !jobs ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button className="btn-ghost" onClick={refresh}>Retry</button>
        </div>
      ) : !jobs ? (
        <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-36 animate-pulse bg-slate-100 dark:bg-slate-900" />)}</div>
      ) : visible.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-medium">{jobs.length === 0 ? "No jobs yet" : "No jobs match"}</p>
          <p className="mt-1 text-sm text-slate-500">
            {jobs.length === 0 ? "New posts from your channels appear here every 30 minutes." : "Try clearing the search or filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.slice(0, shown).map((j) => (
            <JobCard key={j.id} job={j} applied={applied.has(j.id)} onToggle={() => toggle(j.id)} isNew={lastVisit > 0 && new Date(j.added_at).getTime() > lastVisit} />
          ))}
          {visible.length > shown && (
            <button className="btn-ghost w-full" onClick={() => setShown(shown + PAGE)}>Show more ({visible.length - shown} left)</button>
          )}
        </div>
      )}
    </div>
  );
}
