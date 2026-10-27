"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PasswordRequired, WrongPassword, fetchJobs, jobBody, jobTitle, parseIso, timeAgo, type Job } from "@/lib/jobs";
import { daysLeft, deadlineBadge, parseJobCached } from "@/lib/extract";
import AddJobDialog from "./AddJobDialog";
import CountUp from "./CountUp";
import HeroVisual from "./HeroVisual";
import TokenDialog from "./TokenDialog";
import { useToast } from "./Toast";
import { RETRY_MS, TokenRejected, dispatchDelete, getPending, getToken, remoteDeleteAvailable, setPending } from "@/lib/remote";

const PAGE = 24;
const REFRESH_MS = 5 * 60_000;
const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

const TONE = {
  urgent: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  expired: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};
const AVATAR = [
  "linear-gradient(135deg,#ff9ec4,#ff6fa5)", "linear-gradient(135deg,#8fd3ff,#5ab4ff)", "linear-gradient(135deg,#d08bff,#a65bff)",
  "linear-gradient(135deg,#ffd27a,#ffa63d)", "linear-gradient(135deg,#7be0b4,#2ec48a)",
];

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

function JobCard({ job, isNew, applied, onToggle, onDelete, index = 0 }: { job: Job; isNew: boolean; applied: boolean; onToggle: () => void; onDelete?: () => void; index?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const parsed = parseJobCached(job.text);
  const company = job.company ?? parsed.company;
  const role = job.role ?? parsed.role;
  const deadline = job.deadline ? parseIso(job.deadline) : parsed.deadline;
  const badge = deadline ? deadlineBadge(deadline) : null;
  const expired = badge?.tone === "expired";
  const title = role ?? jobTitle(job.text);
  const body = job.manual ? job.text.trim() : role ? job.text.trim() : jobBody(job.text);
  const long = body.length > 220 || body.split("\n").length > 4;
  const initial = (company ?? title).replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "•";
  const hue = [...(company ?? title)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length;

  // fade/slide in when scrolled into view
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) return el.classList.add("in");
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && (el.classList.add("in"), io.disconnect()),
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <article ref={ref} style={{ transitionDelay: `${(index % 2) * 70}ms` }} className={`card lift reveal flex flex-col gap-3 p-5 ${applied || expired ? "opacity-65" : ""}`}>
      <div className="flex gap-3.5">
        <div className="font-display grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-xl font-black text-white shadow-md" style={{ background: AVATAR[hue] }} aria-hidden="true">{initial}</div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300">{job.source}</span>
            {isNew && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">New</span>}
            {badge && <span className={`rounded-full px-2.5 py-0.5 font-bold ${TONE[badge.tone]} ${badge.tone === "urgent" ? "pulse-ring" : ""}`}>{badge.label}</span>}
            <span className="text-slate-500">{timeAgo(job.posted_at ?? job.added_at)}</span>
          </div>
          <h3 className="font-display text-lg font-black leading-snug">{title}</h3>
          {company && <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{company}</p>}
        </div>
      </div>
      {body && (
        <div>
          <p className={`whitespace-pre-line break-words text-sm text-slate-600 dark:text-slate-300 ${open ? "" : "line-clamp-3"}`}>
            <Linkified text={body} />
          </p>
          {long && (
            <button onClick={() => setOpen(!open)} className="mt-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
              {open ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {job.apply_link ? (
          <a href={job.apply_link} target="_blank" rel="noopener noreferrer" className="btn-primary">Apply ↗</a>
        ) : job.post_url ? (
          <a href={job.post_url} target="_blank" rel="noopener noreferrer" className="btn-primary">Open post ↗</a>
        ) : null}
        {job.apply_link && job.post_url && <a href={job.post_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">Original post</a>}
        {onDelete && (
          <button type="button" className="btn-ghost ml-auto !px-3 text-rose-600" aria-label="Delete this job" title="Delete" onClick={() => confirm(job.manual ? "Delete this job?" : "Delete this job permanently? It will be removed from your site on every device.") && onDelete()}>🗑</button>
        )}
        <label className={`${onDelete ? "" : "ml-auto "}flex cursor-pointer select-none items-center gap-1.5 text-sm font-semibold`}>
          <input type="checkbox" checked={applied} onChange={onToggle} className="h-4 w-4 rounded" />
          Applied
        </label>
      </div>
    </article>
  );
}

type Quick = "all" | "new" | "soon";

function Tile({ label, n, bg, shadow, active, onClick, delay, glyph }: { label: string; n: number; bg: string; shadow: string; active: boolean; onClick: () => void; delay: number; glyph: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <button className="tile" aria-pressed={active} onClick={onClick} style={{ background: bg, animationDelay: `${delay}ms`, ["--tile-shadow" as string]: shadow }}>
        <span className="glyph" aria-hidden="true">{glyph}</span>
        <span className="num"><CountUp value={n} /></span>
      </button>
      <span className="tile-label">{label}</span>
    </div>
  );
}

const Star = <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.6L21 9.3l-5 4.4 1.6 6.8L12 17l-5.6 3.5L8 13.7 3 9.3l6.6-.7z" /></svg>;
const Clock = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const Grid = <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg>;

export default function JobsFeed() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [hideApplied, setHideApplied] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [lastVisit, setLastVisit] = useState<number>(0);
  const [shown, setShown] = useState(PAGE);
  const [password, setPassword] = useState("");
  const [locked, setLocked] = useState<"no" | "need" | "wrong">("no");
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState<Job[]>([]);
  const [adding, setAdding] = useState(false);
  const [pending, setPendingState] = useState<Record<string, number>>({});
  const [keyDialog, setKeyDialog] = useState<null | { reason?: string }>(null);
  const toast = useToast();

  const refresh = useCallback(async (pw: string = password) => {
    try {
      const f = await fetchJobs(pw);
      setJobs(f.jobs);
      setUpdatedAt(f.updated_at);
      setError(null);
      setLocked("no");
      if (pw) save("jobs_pw", pw); // remembered in this browser so you don't retype it
    } catch (e) {
      if (e instanceof PasswordRequired) setLocked("need");
      else if (e instanceof WrongPassword) {
        setLocked("wrong");
        save("jobs_pw", "");
      } else setError(e instanceof Error ? e.message : "Could not load jobs");
    }
  }, [password]);

  useEffect(() => {
    setPassword(load<string>("jobs_pw", ""));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    setApplied(new Set(load<string[]>("jobs_applied", [])));
    setManual(load<Job[]>("jobs_manual", []));
    setPendingState(getPending());
    setLastVisit(load<number>("jobs_last_visit", 0));
    const leave = () => save("jobs_last_visit", Date.now()); // "New" = arrived since you last visited
    window.addEventListener("pagehide", leave);
    refresh();
    const id = setInterval(() => refresh(), REFRESH_MS);
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, password]);

  // menu actions
  useEffect(() => {
    const add = () => setAdding(true);
    const lock = () => {
      save("jobs_pw", "");
      setPassword("");
      setJobs(null);
      setLocked("need");
    };
    const key = () => setKeyDialog({});
    window.addEventListener("openings:add", add);
    window.addEventListener("openings:lock", lock);
    window.addEventListener("openings:key", key);
    return () => {
      window.removeEventListener("openings:add", add);
      window.removeEventListener("openings:lock", lock);
      window.removeEventListener("openings:key", key);
    };
  }, []);

  const toggle = (id: string) =>
    setApplied((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      save("jobs_applied", [...next]);
      return next;
    });

  const addManual = (job: Job) => {
    const next = [job, ...manual];
    setManual(next);
    save("jobs_manual", next);
    setAdding(false);
  };
  const removeManual = (id: string) => {
    const next = manual.filter((j) => j.id !== id);
    setManual(next);
    save("jobs_manual", next);
  };

  const savePending = (p: Record<string, number>) => {
    setPendingState(p);
    setPending(p);
  };

  /** Ask the collector to remove these jobs for good. They stay hidden on this device meanwhile. */
  const sendDeletes = async (p: Record<string, number>, quiet = false) => {
    const ids = Object.keys(p);
    if (!ids.length) return;
    const token = getToken();
    if (!token) {
      if (!quiet) setKeyDialog({});
      return;
    }
    try {
      await dispatchDelete(ids, token);
      savePending(Object.fromEntries(ids.map((id) => [id, Date.now()])));
      if (!quiet) toast("Deleted. It disappears on all your devices within about a minute.", "success");
    } catch (e) {
      if (e instanceof TokenRejected) setKeyDialog({ reason: `${e.message} Check the key, then try again.` });
      else if (!quiet) toast(`Hidden here, but ${e instanceof Error ? e.message : "the delete failed"} It will retry.`);
    }
  };

  const deleteJob = (job: Job) => {
    if (job.manual) return removeManual(job.id);
    const next = { ...pending, [job.id]: Date.now() };
    savePending(next);
    if (remoteDeleteAvailable) sendDeletes(next);
  };

  // once the data no longer has a deleted job, forget it; if it is still there after a while, ask again
  useEffect(() => {
    if (!jobs) return;
    const present = new Set(jobs.map((j) => j.id));
    const left = Object.fromEntries(Object.entries(pending).filter(([id]) => present.has(id)));
    if (Object.keys(left).length !== Object.keys(pending).length) savePending(left);
    if (remoteDeleteAvailable && Object.values(left).some((t) => Date.now() - t > RETRY_MS)) sendDeletes(left, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const all = useMemo(() => [...manual, ...(jobs ?? []).filter((j) => !pending[j.id])], [manual, jobs, pending]);
  const deadlineOf = (j: Job) => (j.deadline ? parseIso(j.deadline) : parseJobCached(j.text).deadline);
  const isNewJob = useCallback((j: Job) => lastVisit > 0 && new Date(j.added_at).getTime() > lastVisit, [lastVisit]);
  const isSoon = (j: Job) => {
    const dl = deadlineOf(j);
    if (!dl) return false;
    const d = daysLeft(dl);
    return d >= 0 && d <= 7;
  };

  const counts = useMemo(() => ({ total: all.length, fresh: all.filter(isNewJob).length, soon: all.filter(isSoon).length }), [all, isNewJob]);
  const sources = useMemo(() => [...new Set(all.map((j) => j.source))].sort(), [all]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (j) =>
        (!source || j.source === source) &&
        (quick === "all" || (quick === "new" ? isNewJob(j) : isSoon(j))) &&
        (!hideApplied || !applied.has(j.id)) &&
        (!q || `${j.text} ${j.company ?? ""} ${j.role ?? ""}`.toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, source, quick, hideApplied, applied, isNewJob]);

  useEffect(() => setShown(PAGE), [search, source, quick, hideApplied]);

  if (locked !== "no") {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <form
          className="card mx-auto w-full max-w-sm animate-[pop-in_.4s_both] space-y-3 p-7"
          onSubmit={(e) => {
            e.preventDefault();
            const pw = (new FormData(e.currentTarget).get("pw") as string) ?? "";
            // a new password re-runs the loading effect; the same one (a retry) needs an explicit load
            if (pw === password) refresh(pw);
            else setPassword(pw);
          }}
        >
          <h1 className="font-display text-2xl font-black">🔒 Enter password</h1>
          <p className="text-sm text-slate-500">These jobs are private. Enter the password you set up (it is remembered on this device).</p>
          <input name="pw" type="password" autoComplete="current-password" autoFocus className="input" placeholder="Password" aria-label="Password" />
          {locked === "wrong" && <p className="text-sm font-semibold text-rose-600">Wrong password. Try again.</p>}
          <button className="btn-primary w-full !py-3">Unlock</button>
        </form>
      </div>
    );
  }

  const tile = (q: Quick) => () => setQuick(quick === q ? "all" : q);
  return (
    <div>
      {/* ---------- hero ---------- */}
      <section className="grid grid-cols-1 items-center gap-6 pb-12 pt-4 lg:grid-cols-[1.1fr_1fr] lg:pt-10">
        <div className="min-w-0">
          <h1 className="hero-title text-[clamp(2.3rem,10.5vw,3.6rem)] sm:text-[clamp(3rem,6vw,4.6rem)] lg:text-[clamp(3rem,5vw,4.9rem)]">
            <span className="line"><span style={{ animationDelay: "0.05s" }}>Find your next</span></span>
            <span className="line"><span style={{ animationDelay: "0.2s" }}>opportunity</span></span>
          </h1>
          <p className="mt-4 max-w-md animate-[fade-up_.8s_.45s_both] break-words text-base font-bold text-white/90 drop-shadow">Fresh openings from your groups, collected for you.</p>
          <a href="#jobs" className="btn-pill mt-7 animate-[fade-up_.8s_.55s_both]">
            Browse jobs
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </a>
          <div className="mt-10 flex flex-wrap items-start gap-3 sm:gap-4">
            <Tile label="New" n={counts.fresh} bg="linear-gradient(160deg,#ff9ec4,#ff6fa5)" shadow="rgb(255 80 150 / .6)" active={quick === "new"} onClick={tile("new")} delay={500} glyph={Star} />
            <Tile label="Closing soon" n={counts.soon} bg="linear-gradient(160deg,#8fd3ff,#4aa8ff)" shadow="rgb(60 150 255 / .6)" active={quick === "soon"} onClick={tile("soon")} delay={600} glyph={Clock} />
            <Tile label="All jobs" n={counts.total} bg="linear-gradient(160deg,#d08bff,#9a55ff)" shadow="rgb(140 70 255 / .6)" active={quick === "all"} onClick={() => setQuick("all")} delay={700} glyph={Grid} />
            <button className="round-add mt-[2.7rem] animate-[fade-up_.8s_.8s_both] sm:mt-[3.3rem]" aria-label="Add a job manually" title="Add a job or company by hand" onClick={() => setAdding(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        </div>
        <HeroVisual />
      </section>

      {/* ---------- list ---------- */}
      <section id="jobs" className="scroll-mt-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-display text-3xl font-black text-white drop-shadow-[0_4px_18px_rgba(90,40,170,.35)]">Latest openings</h2>
          <p className="text-xs font-semibold text-white/90">
            {jobs || manual.length ? `${visible.length} job${visible.length === 1 ? "" : "s"}` : ""}
            {updatedAt ? ` · Updated ${timeAgo(updatedAt)}` : ""} ·{" "}
            <button onClick={() => refresh()} className="underline">Refresh</button>
          </p>
        </div>

        <div className="card mb-5 grid gap-3 p-3 sm:grid-cols-[1fr_13rem_auto] sm:items-center">
          <input className="input" type="search" placeholder="Search jobs, companies, skills…" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap px-1 text-sm font-semibold">
            <input type="checkbox" className="h-4 w-4" checked={hideApplied} onChange={(e) => setHideApplied(e.target.checked)} />
            Hide applied
          </label>
        </div>

        {error && !jobs ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-semibold text-rose-600">{error}</p>
            <button className="btn-ghost" onClick={() => refresh()}>Retry</button>
          </div>
        ) : !jobs && manual.length === 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card skeleton h-40" />)}</div>
        ) : visible.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="font-display text-xl font-black">{all.length === 0 ? "No jobs yet" : "No jobs match"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {all.length === 0 ? "New posts from your channels appear here every 30 minutes. You can also add one with the + button." : "Try clearing the search or the filter tiles."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visible.slice(0, shown).map((j, i) => (
              <JobCard key={j.id} index={i} job={j} applied={applied.has(j.id)} onToggle={() => toggle(j.id)} onDelete={() => deleteJob(j)} isNew={isNewJob(j)} />
            ))}
            {visible.length > shown && (
              <button className="btn-pill justify-center self-start lg:col-span-2 lg:mx-auto" onClick={() => setShown(shown + PAGE)}>Show more ({visible.length - shown} left)</button>
            )}
          </div>
        )}
      </section>

      {adding && <AddJobDialog onClose={() => setAdding(false)} onSave={addManual} />}
      {keyDialog && (
        <TokenDialog
          reason={keyDialog.reason}
          onClose={() => setKeyDialog(null)}
          onSaved={() => {
            setKeyDialog(null);
            sendDeletes(pending);
          }}
        />
      )}
    </div>
  );
}
