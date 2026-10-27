"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RateLimited, completeLogin, disconnect, fetchNowPlaying, getClientId, isConnected, redirectUri, startLogin,
  type NowState,
} from "@/lib/spotify";
import { applyPalette, paletteFromImage } from "@/lib/palette";

const POLL_MS = 5000;
const GREEN = "#1ed760";

const SpotifyMark = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" />
    <path d="M7 9.1c3.3-1 7.2-.7 10.2.9M7.7 12.3c2.7-.8 5.9-.5 8.4.8M8.3 15.4c2.2-.6 4.6-.4 6.5.6" />
  </svg>
);

function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {[0, 0.25, 0.5, 0.15].map((d, i) => (
        <span
          key={i}
          className={`w-[3px] origin-bottom rounded-full bg-[#1ed760] ${playing ? "animate-eq" : ""}`}
          style={{ height: "100%", animationDelay: `${d}s`, transform: playing ? undefined : "scaleY(.3)" }}
        />
      ))}
    </span>
  );
}

export default function SpotifyWidget() {
  const [clientId, setClientId] = useState("");
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState<NowState | null>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [themeOn, setThemeOn] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // "Spotify" item in the menu
  useEffect(() => {
    const show = () => (isConnected() ? setMenu((m) => !m) : setOpen((o) => !o));
    window.addEventListener("openings:spotify", show);
    return () => window.removeEventListener("openings:spotify", show);
  }, []);

  // restore settings, and finish a login if Spotify just redirected back here
  useEffect(() => {
    setClientId(getClientId());
    setConnected(isConnected());
    try {
      setThemeOn(localStorage.getItem("spotify_theme") !== "off");
    } catch {}
    completeLogin().then((r) => {
      if (r === "connected") {
        setConnected(true);
        setMessage(null);
      } else if (r === "error") {
        setOpen(true);
        setMessage("Spotify login did not finish. Check the Client ID and the Redirect URI, then try again.");
      }
    });
  }, []);

  // poll now-playing while connected and the tab is visible
  const poll = useCallback(async () => {
    let wait = POLL_MS;
    try {
      setNow(await fetchNowPlaying());
    } catch (e) {
      if (e instanceof RateLimited) wait = e.retryAfterMs;
      else if (e instanceof Error && (e.message === "expired" || e.message === "not connected")) {
        setConnected(false);
        setNow(null);
        setOpen(true);
        setMessage("Your Spotify session ended. Connect again.");
        return;
      }
    }
    if (!document.hidden) timer.current = setTimeout(poll, wait);
  }, []);

  useEffect(() => {
    if (!connected) return;
    poll();
    const vis = () => {
      clearTimeout(timer.current);
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [connected, poll]);

  // smooth progress bar
  useEffect(() => {
    if (!now || now === "idle" || !now.isPlaying) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [now]);

  // theme the whole site from the cover art
  const art = now && now !== "idle" && now.isPlaying ? now.art : null;
  useEffect(() => {
    let cancelled = false;
    if (!art || !themeOn) {
      applyPalette(null);
      return;
    }
    paletteFromImage(art)
      .then((p) => !cancelled && applyPalette(p))
      .catch(() => !cancelled && applyPalette(null));
    return () => {
      cancelled = true;
    };
  }, [art, themeOn]);

  const toggleTheme = () => {
    const next = !themeOn;
    setThemeOn(next);
    try {
      localStorage.setItem("spotify_theme", next ? "on" : "off");
    } catch {}
  };

  const doDisconnect = () => {
    disconnect();
    setConnected(false);
    setNow(null);
    setMenu(false);
    applyPalette(null);
  };

  const copyUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const playing = now && now !== "idle" ? now : null;
  const progress = playing
    ? Math.min(100, ((playing.progressMs + (playing.isPlaying ? Date.now() - playing.fetchedAt : 0)) / Math.max(1, playing.durationMs)) * 100)
    : 0;
  void tick;

  return (
    <div className="fixed bottom-3 right-3 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && !connected && (
        <div className="card w-[min(22rem,calc(100vw-2rem))] animate-pop-in space-y-3 p-4 text-sm" role="dialog" aria-label="Connect Spotify">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><SpotifyMark /> Connect Spotify</h2>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">✕</button>
          </div>
          <p className="text-slate-600 dark:text-slate-400">Shows what you are playing and tints this site with the album colours. One-time setup (free):</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-slate-600 dark:text-slate-400">
            <li>
              Open <a className="text-indigo-600 underline dark:text-indigo-400" href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">developer.spotify.com/dashboard</a> and create an app (tick <b>Web API</b>).
            </li>
            <li>
              Add this as a <b>Redirect URI</b>:
              <button onClick={copyUri} className="mt-1 block w-full break-all rounded-lg border border-dashed border-slate-400/50 px-2 py-1 text-left font-mono text-xs hover:border-indigo-500" title="Click to copy">
                {typeof window !== "undefined" ? redirectUri() : ""} <span className="text-indigo-600 dark:text-indigo-400">{copied ? "✓ copied" : "(copy)"}</span>
              </button>
            </li>
            <li>Paste the app&apos;s <b>Client ID</b> below.</li>
          </ol>
          <input className="input font-mono" placeholder="Client ID" aria-label="Spotify Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
          {message && <p className="text-red-600 dark:text-red-400">{message}</p>}
          <button className="btn-primary w-full" disabled={clientId.trim().length < 10} onClick={() => startLogin(clientId)}>Connect Spotify</button>
        </div>
      )}

      {connected && (
        <div className="card relative w-[min(19rem,calc(100vw-2rem))] animate-pop-in overflow-hidden p-3">
          {playing?.art && <div className="pointer-events-none absolute -inset-4 -z-10 opacity-40 blur-2xl" style={{ backgroundImage: `url(${playing.art})`, backgroundSize: "cover" }} />}
          <div className="flex items-center gap-3">
            {playing?.art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={playing.art} alt="" width={48} height={48} className={`h-12 w-12 rounded-lg object-cover shadow-lg ${playing.isPlaying ? "" : "grayscale"}`} />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-slate-500/20"><SpotifyMark size={24} /></span>
            )}
            <div className="min-w-0 flex-1">
              {playing ? (
                <>
                  <a href={playing.url ?? "https://open.spotify.com"} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold hover:underline" title="Open in Spotify">{playing.title}</a>
                  <p className="truncate text-xs text-slate-600 dark:text-slate-400">{playing.artist}</p>
                </>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">{now === null ? "Connecting…" : "Nothing playing"}</p>
              )}
            </div>
            <Equalizer playing={!!playing?.isPlaying} />
            <button onClick={() => setMenu(!menu)} aria-label="Spotify options" className="px-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">⋯</button>
          </div>
          {playing && <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-slate-500/25"><div className="h-full rounded-full bg-[#1ed760] transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>}
          {menu && (
            <div className="mt-3 space-y-2 border-t border-slate-500/20 pt-3 text-sm">
              <label className="flex cursor-pointer items-center justify-between gap-2">
                Match site colours to album
                <input type="checkbox" checked={themeOn} onChange={toggleTheme} className="h-4 w-4" />
              </label>
              <button onClick={doDisconnect} className="text-red-600 hover:underline dark:text-red-400">Disconnect Spotify</button>
              <p className="flex items-center gap-1 text-xs text-slate-500"><SpotifyMark size={14} /> Playback data from Spotify</p>
            </div>
          )}
        </div>
      )}

      {!connected && (
        <button
          onClick={() => setOpen(!open)}
          aria-label="Connect Spotify"
          title="Connect Spotify"
          className="grid h-11 w-11 place-items-center rounded-full border border-slate-500/30 bg-[rgb(var(--surface)/0.7)] shadow-lg backdrop-blur-xl transition hover:scale-110 hover:shadow-[0_0_24px_-4px_#1ed760]"
        >
          <SpotifyMark size={24} />
        </button>
      )}
    </div>
  );
}
