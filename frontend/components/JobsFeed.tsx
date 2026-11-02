"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PasswordRequired, WrongPassword, fetchJobs, jobBody, jobTitle, parseIso, postText, timeAgo, type Job } from "@/lib/jobs";
import { daysLeft, deadlineBadge, parseJobCached } from "@/lib/extract";
import AddJobDialog from "./AddJobDialog";
import CountUp from "./CountUp";
import HeroVisual from "./HeroVisual";
import TokenDialog from "./TokenDialog";
import ApplyKit from "./ApplyKit";
import { DONE_APPLYING, STATUSES, followUpBadge, loadTracker, saveTracker, withStatus, type Status, type Track, type Tracker } from "@/lib/tracker";
import { useToast } from "./Toast";
import JobCalendar from "./JobCalendar";
import { dayKey, dayLabel, jobDay, jobTime } from "@/lib/days";
import { isFresherJob } from "@/lib/fresher";
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
// earthy letter avatars: terracotta, mustard, sage, clay rose, slate blue
const AVATAR = [
  "linear-gradient(135deg,#e07a4f,#c2410c)", "linear-gradient(135deg,#e3b04b,#c98a12)", "linear-gradient(135deg,#8fa16a,#5f7240)",
  "linear-gradient(135deg,#d9849a,#b4536b)", "linear-gradient(135deg,#7a95b8,#4d6a91)",
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
          <a key={i} href={part.replace(/[.,;:!?]+$/, "")} target="_blank" rel="noopener noreferrer" className="break-all text-brand-600 underline dark:text-brand-400">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function JobCard({ job, isNew, track, onStatus, onKit, onDelete, index = 0 }: {
  job: Job; isNew: boolean; track?: Track; onStatus: (s: Status) => void; onKit: () => void; onDelete?: () => void; index?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const text = postText(job); // without a WhatsApp sender's name in front
  const parsed = parseJobCached(text);
  const company = job.company ?? parsed.company;
  const role = job.role ?? parsed.role;
  const deadline = job.deadline ? parseIso(job.deadline) : parsed.deadline;
  const badge = deadline ? deadlineBadge(deadline) : null;
  const expired = badge?.tone === "expired";
  const title = role ?? jobTitle(text);
  const body = job.manual ? text.trim() : role ? text.trim() : jobBody(text);
  // "Read more" whenever the 3-line preview actually hides text (depends on the card's width)
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || open) return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [body, open]);
  const initial = (company ?? title).replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "•";
  const hue = [...(company ?? title)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length;
  const fu = followUpBadge(track);
  const st = STATUSES.find((x) => x.value === (track?.status ?? "")) ?? STATUSES[0];

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
    <article ref={ref} style={{ transitionDelay: `${(index % 2) * 70}ms` }} className={`card lift reveal flex flex-col gap-3 p-5 ${expired || track?.status === "rejected" ? "opacity-65" : ""}`}>
      <div className="flex gap-3.5">
        <div className="font-display grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-xl font-bold text-white shadow-md" style={{ background: AVATAR[hue] }} aria-hidden="true">{initial}</div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300">{job.source}</span>
            {isNew && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">New</span>}
            {isFresherJob(job) && <span className="rounded-full bg-brand-100 px-2.5 py-0.5 font-bold text-brand-800 dark:bg-brand-950 dark:text-brand-300">🎓 Freshers</span>}
            {badge && <span className={`rounded-full px-2.5 py-0.5 font-bold ${TONE[badge.tone]} ${badge.tone === "urgent" ? "pulse-ring" : ""}`}>{badge.label}</span>}
            {fu && <span className={`rounded-full px-2.5 py-0.5 font-bold ${fu.urgent ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>⏰ {fu.label}</span>}
            <span className="text-slate-500">{timeAgo(job.posted_at ?? job.added_at)}</span>
          </div>
          <h3 className="font-display text-lg font-bold leading-snug">{title}</h3>
          {company && <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{company}</p>}
        </div>
      </div>
      {body && (
        <div>
          <p ref={bodyRef} className={`whitespace-pre-line break-words text-sm text-slate-600 dark:text-slate-300 ${open ? "" : "line-clamp-3"}`}>
            <Linkified text={body} />
          </p>
          {(cut || open) && (
            <button onClick={() => setOpen(!open)} className="mt-1 text-xs font-bold text-brand-600 hover:underline dark:text-brand-400">
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
        <button type="button" className="btn-ghost" onClick={onKit} title="Email HR, ask for a referral, follow up, track">✉️ Apply kit</button>
        <div className="ml-auto flex items-center gap-2">
          <select aria-label="Application status" value={track?.status ?? ""} onChange={(e) => onStatus(e.target.value as Status)}
            className={`cursor-pointer rounded-full border-0 py-1.5 pl-3 pr-7 text-xs font-bold outline-none ring-brand-500/40 focus:ring-4 ${st.tone}`}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {onDelete && (
            <button type="button" className="btn-ghost !px-3 text-rose-600" aria-label="Delete this job" title="Delete" onClick={() => confirm(job.manual ? "Delete this job?" : "Delete this job permanently? It will be removed from your site on every device.") && onDelete()}>🗑</button>
          )}
        </div>
      </div>
    </article>
  );
}

type Quick = "all" | "new" | "soon" | "mine";

function Tile({ label, n, tone, active, onClick, delay, glyph }: { label: string; n: number; tone: "rose" | "blue" | "green" | "brand"; active: boolean; onClick: () => void; delay: number; glyph: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <button className="tile" aria-pressed={active} aria-label={`${label}: ${n}`} onClick={onClick} style={{ animationDelay: `${delay}ms`, ["--tile-color" as string]: `var(--tone-${tone})` }}>
        <span className="glyph" aria-hidden="true">{glyph}</span>
        <span className="num"><CountUp value={n} /></span>
      </button>
      <span className="tile-label">{label}</span>
    </div>
  );
}

const Star = <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.6L21 9.3l-5 4.4 1.6 6.8L12 17l-5.6 3.5L8 13.7 3 9.3l6.6-.7z" /></svg>;
const Clock = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const Check = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const Grid = <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></svg>;

export default function JobsFeed() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [hideApplied, setHideApplied] = useState(false);
  const [showRejected, setShowRejected] = useState(false); // rejected jobs are hidden unless you open this list
  const [today] = useState(() => dayKey(new Date()));
  const [day, setDay] = useState(today); // the day being shown ("2026-11-01"); "" = every date
  const [calOpen, setCalOpen] = useState(false); // phones: calendar under the day bar
  const [freshers, setFreshers] = useState(false); // only fresher-friendly jobs (remembered)
  useEffect(() => setFreshers(load("freshers_only", false)), []);
  const toggleFreshers = () => {
    setFreshers(!freshers);
    save("freshers_only", !freshers);
  };
  const [tracker, setTrackerState] = useState<Tracker>({});
  const [kitJob, setKitJob] = useState<Job | null>(null);
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
    setTrackerState(loadTracker());
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

  const setTrack = (id: string, t: Track) =>
    setTrackerState((prev) => {
      const next = { ...prev, [id]: t };
      if (!t.status && !t.note && !t.followUp) delete next[id];
      saveTracker(next);
      return next;
    });
  const statusOf = (id: string): Status => tracker[id]?.status ?? "";
  const setStatus = (j: Job, st: Status) => {
    setTrack(j.id, withStatus(tracker[j.id], st));
    if (st === "rejected" && !showRejected) toast("Marked rejected and removed from your list. Find it under \"rejected hidden\" if you need it.", "success");
  };

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

  // Jobs you were rejected from leave the list and the counts.
  // "Freshers only" narrows everything: counts, calendar, day bar and list.
  const pool = useMemo(() => (freshers ? all.filter(isFresherJob) : all), [all, freshers]);
  const rejected = useMemo(() => pool.filter((j) => tracker[j.id]?.status === "rejected"), [pool, tracker]);
  const open = useMemo(() => pool.filter((j) => tracker[j.id]?.status !== "rejected"), [pool, tracker]);
  const counts = useMemo(
    () => ({ total: open.length, fresh: open.filter(isNewJob).length, soon: open.filter(isSoon).length, mine: open.filter((j) => statusOf(j.id)).length }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, isNewJob, tracker],
  );
  const sources = useMemo(() => [...new Set(all.map((j) => j.source))].sort(), [all]);
  // Everything the filters allow (newest first); the calendar counts these, the list shows the chosen day.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (showRejected ? rejected : open).filter(
      (j) =>
        (!source || j.source === source) &&
        (showRejected || quick === "all" || (quick === "new" ? isNewJob(j) : quick === "soon" ? isSoon(j) : !!statusOf(j.id))) &&
        (showRejected || !hideApplied || !DONE_APPLYING.includes(statusOf(j.id))) &&
        (!q || `${j.text} ${j.company ?? ""} ${j.role ?? ""}`.toLowerCase().includes(q)),
    ).sort((a, b) => jobTime(b) - jobTime(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rejected, showRejected, search, source, quick, hideApplied, tracker, isNewJob]);
  const perDay = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of filtered) c[jobDay(j)] = (c[jobDay(j)] ?? 0) + 1;
    return c;
  }, [filtered]);
  // One day at a time (today first). Searching and the New / Closing soon / My applications counters look at every date.
  const searching = search.trim() !== "";
  const shownDay = searching || quick !== "all" ? "" : day;
  const visible = useMemo(() => (shownDay ? filtered.filter((j) => jobDay(j) === shownDay) : filtered), [filtered, shownDay]);
  const jobDays = useMemo(() => Object.keys(perDay).sort(), [perDay]);
  const prevDay = shownDay ? jobDays.filter((k) => k < shownDay).pop() : undefined; // skips days without jobs
  const nextDay = shownDay ? jobDays.find((k) => k > shownDay) ?? (shownDay < today ? today : undefined) : undefined;
  const pickDay = (k: string) => {
    setSearch("");
    setQuick("all");
    setDay(k);
    setCalOpen(false);
  };

  useEffect(() => setShown(PAGE), [search, source, quick, hideApplied, showRejected, shownDay, freshers]);
  useEffect(() => {
    if (showRejected && rejected.length === 0) setShowRejected(false);
  }, [showRejected, rejected.length]);

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
          <h1 className="font-display text-2xl font-bold">🔒 Enter password</h1>
          <p className="text-sm text-slate-500">These jobs are private. Enter the password you set up (it is remembered on this device).</p>
          <input name="pw" type="password" autoComplete="current-password" autoFocus className="input" placeholder="Password" aria-label="Password" />
          {locked === "wrong" && <p className="text-sm font-semibold text-rose-600">Wrong password. Try again.</p>}
          <button className="btn-primary w-full !py-3">Unlock</button>
        </form>
      </div>
    );
  }

  const tile = (q: Quick) => () => {
    setShowRejected(false);
    setQuick(quick === q ? "all" : q);
  };
  return (
    <div>
      {/* ---------- hero ---------- */}
      <section className="grid grid-cols-1 items-center gap-6 pb-12 pt-4 lg:grid-cols-[1.1fr_1fr] lg:pt-10">
        <div className="min-w-0">
          <h1 className="hero-title text-[clamp(2.3rem,10.5vw,3.6rem)] sm:text-[clamp(3rem,6vw,4.6rem)] lg:text-[clamp(3rem,5vw,4.9rem)]">
            <span className="line"><span style={{ animationDelay: "0.05s" }}>Find your next</span></span>
            <span className="line"><span style={{ animationDelay: "0.2s" }}>opportunity</span></span>
          </h1>
          <p className="mt-4 max-w-md animate-[fade-up_.8s_.45s_both] break-words text-base font-semibold on-bg-muted">Fresh openings from your groups, collected for you.</p>
          <a href="#jobs" className="btn-pill mt-7 animate-[fade-up_.8s_.55s_both]">
            Browse jobs
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </a>
          <div className="mt-10 flex flex-wrap items-start gap-2 sm:gap-4">
            <Tile label="New" n={counts.fresh} tone="rose" active={quick === "new"} onClick={tile("new")} delay={500} glyph={Star} />
            <Tile label="Closing soon" n={counts.soon} tone="blue" active={quick === "soon"} onClick={tile("soon")} delay={600} glyph={Clock} />
            <Tile label="My applications" n={counts.mine} tone="green" active={quick === "mine"} onClick={tile("mine")} delay={650} glyph={Check} />
            <Tile label="All jobs" n={counts.total} tone="brand" active={quick === "all" && !day && !searching && !showRejected} onClick={() => { setShowRejected(false); setDay(""); setQuick("all"); }} delay={700} glyph={Grid} />
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
          <h2 className="font-display on-bg text-3xl font-bold">{showRejected ? "Rejected" : "Latest openings"}</h2>
          <p className="on-bg-muted text-xs font-semibold">
            {jobs || manual.length ? `${visible.length} ${freshers ? "fresher " : ""}job${visible.length === 1 ? "" : "s"}` : ""}
            {updatedAt ? ` · Updated ${timeAgo(updatedAt)}` : ""} ·{" "}
            <button onClick={() => refresh()} className="underline">Refresh</button>
            {(rejected.length > 0 || showRejected) && (
              <>
                {" · "}
                <button onClick={() => setShowRejected(!showRejected)} className="underline">
                  {showRejected ? "Back to openings" : `${rejected.length} rejected hidden`}
                </button>
              </>
            )}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_19rem]">
        <div className="min-w-0">
        <div className="card mb-5 grid gap-3 p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-center">
          <input className="input" type="search" placeholder="Search jobs, companies, skills…" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={toggleFreshers}
              aria-pressed={freshers}
              title="Show only jobs for freshers: 0–1 years, trainee, internships, off-campus, batch-wise hiring"
              className={`rounded-full border px-3.5 py-2 text-sm font-bold transition ${freshers ? "border-transparent bg-brand-600 text-white dark:text-[#1c1410]" : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] hover:border-brand-500"}`}
            >
              🎓 Freshers only{freshers ? " ✓" : ""}
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap px-1 text-sm font-semibold">
              <input type="checkbox" className="h-4 w-4" checked={hideApplied} onChange={(e) => setHideApplied(e.target.checked)} />
              Hide applied
            </label>
          </div>
        </div>

        {shownDay ? (
          <div className="card mb-5 flex items-center justify-between gap-2 p-2">
            <button className="btn-ghost !px-3" disabled={!prevDay} onClick={() => prevDay && setDay(prevDay)} aria-label="Previous day">
              ‹<span className="hidden sm:inline">{prevDay ? dayLabel(prevDay) : "Earlier"}</span>
            </button>
            <div className="min-w-0 text-center">
              <button className="font-display text-lg font-bold lg:pointer-events-none" onClick={() => setCalOpen(!calOpen)} aria-expanded={calOpen} aria-label="Pick a date">
                <span data-testid="day-title">{dayLabel(shownDay)}</span>
                <span className="ml-1 text-sm lg:hidden" aria-hidden="true">📅</span>
              </button>
              <div className="on-bg-muted text-xs font-semibold">
                {perDay[shownDay] ?? 0} job{perDay[shownDay] === 1 ? "" : "s"}
                {shownDay !== today && <> · <button className="underline" onClick={() => setDay(today)}>Back to today</button></>}
              </div>
            </div>
            <button className="btn-ghost !px-3" disabled={!nextDay} onClick={() => nextDay && setDay(nextDay)} aria-label="Next day">
              <span className="hidden sm:inline">{nextDay ? dayLabel(nextDay) : "Later"}</span>›
            </button>
          </div>
        ) : (
          <p className="on-bg-muted mb-3 text-xs font-semibold">
            {searching ? "Searching every date." : quick !== "all" ? "From every date." : "Every date, newest first."}{" "}
            <button className="underline" onClick={() => { setSearch(""); setQuick("all"); setDay(today); }}>Show today only</button>
            <button className="ml-2 underline lg:hidden" onClick={() => setCalOpen(!calOpen)}>Pick a date</button>
          </p>
        )}

        {calOpen && (
          <div className="mb-5 lg:hidden">
            <JobCalendar counts={perDay} value={shownDay} onChange={pickDay} alwaysOpen />
          </div>
        )}

        {error && !jobs ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-semibold text-rose-600">{error}</p>
            <button className="btn-ghost" onClick={() => refresh()}>Retry</button>
          </div>
        ) : !jobs && manual.length === 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card skeleton h-40" />)}</div>
        ) : visible.length === 0 && shownDay && filtered.length > 0 ? (
          <div className="card p-10 text-center">
            <p className="font-display text-xl font-bold">{shownDay === today ? `No new ${freshers ? "fresher " : ""}jobs yet today` : `No ${freshers ? "fresher " : ""}jobs on ${dayLabel(shownDay)}`}</p>
            <p className="mt-1 text-sm text-slate-500">New posts arrive every 15 minutes.</p>
            {(prevDay ?? nextDay) && (
              <button className="btn-primary mt-4" onClick={() => setDay((prevDay ?? nextDay)!)}>
                See {dayLabel((prevDay ?? nextDay)!)} · {perDay[(prevDay ?? nextDay)!] ?? 0} job{perDay[(prevDay ?? nextDay)!] === 1 ? "" : "s"}
              </button>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="font-display text-xl font-bold">{all.length === 0 ? "No jobs yet" : "No jobs match"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {all.length === 0 ? "New posts from your channels appear here every 15 minutes. You can also add one with the + button." : "Try clearing the search or the filter tiles."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {visible.slice(0, shown).map((j, i, list) => {
              const d = jobDay(j);
              return (
                <Fragment key={j.id}>
                  {!shownDay && (i === 0 || jobDay(list[i - 1]) !== d) && (
                    <h3 className="col-span-full -mb-1 mt-2 flex items-baseline gap-2 font-display on-bg text-lg font-bold first:mt-0" data-testid="day-heading">
                      {dayLabel(d)}
                      <span className="on-bg-muted font-sans text-xs font-bold">{perDay[d] ?? 0} job{perDay[d] === 1 ? "" : "s"}</span>
                    </h3>
                  )}
                  <JobCard index={i} job={j} track={tracker[j.id]} onStatus={(st) => setStatus(j, st)} onKit={() => setKitJob(j)} onDelete={() => deleteJob(j)} isNew={isNewJob(j)} />
                </Fragment>
              );
            })}
            {visible.length > shown && (
              <button className="btn-pill col-span-full justify-center self-start xl:mx-auto" onClick={() => setShown(shown + PAGE)}>Show more ({visible.length - shown} left)</button>
            )}
          </div>
        )}
        </div>
        <aside className="hidden lg:sticky lg:top-4 lg:block lg:self-start">
          <JobCalendar counts={perDay} value={shownDay} onChange={pickDay} />
        </aside>
        </div>
      </section>

      {adding && <AddJobDialog onClose={() => setAdding(false)} onSave={addManual} />}
      {kitJob && (
        <ApplyKit
          job={kitJob}
          company={kitJob.company ?? parseJobCached(postText(kitJob)).company}
          role={kitJob.role ?? parseJobCached(postText(kitJob)).role}
          track={tracker[kitJob.id]}
          onTrack={(t) => setTrack(kitJob.id, t)}
          onClose={() => setKitJob(null)}
        />
      )}
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
