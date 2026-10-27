"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEMO, createSource, getSources, scrapeNow, setSourceEnabled, type Source, type SourceType,
} from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/components/Toast";

const HINTS: Record<string, string> = {
  telegram: "@channel_username, t.me link, or numeric id of a private group you joined",
  youtube: "Channel id (starts with UC…)",
};

export default function SourcesPage() {
  const toast = useToast();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<SourceType>("telegram");
  const [identifier, setIdentifier] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getSources().then((s) => { setSources(s); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    load();
    try {
      setApiKey(localStorage.getItem("api_key") ?? "");
    } catch {}
  }, [load]);

  const saveKey = (v: string) => {
    setApiKey(v);
    try {
      localStorage.setItem("api_key", v);
    } catch {}
  };

  async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok, "success");
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    if (await run(() => createSource(type, identifier.trim(), apiKey), "Source added")) {
      setIdentifier("");
      load();
    }
  }

  async function toggle(s: Source) {
    if (await run(() => setSourceEnabled(s.id, !s.enabled, apiKey))) load();
  }

  async function fetchNow() {
    const r = await run(() => scrapeNow(apiKey));
    if (r) {
      toast(`Fetched ${r.new_items} new posts, ${r.openings} openings${r.errors ? `, ${r.errors} errors (see server logs)` : ""}`, r.errors ? "error" : "success");
      load();
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Sources</h1>
        <p className="mt-1 text-sm text-slate-500">Only the channels listed here are read. New posts are checked every 5 minutes.</p>
      </div>

      <form onSubmit={add} className="card grid gap-3 p-4 sm:grid-cols-[9rem_1fr_auto]">
        <select className="input" aria-label="Source type" value={type} onChange={(e) => setType(e.target.value as SourceType)}>
          <option value="telegram">Telegram</option>
          <option value="youtube">YouTube</option>
        </select>
        <input className="input" aria-label="Identifier" placeholder={HINTS[type]} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        <button className="btn-primary" disabled={busy || !identifier.trim()}>Add</button>
        <input
          className="input sm:col-span-3"
          type="password"
          aria-label="API key"
          placeholder="API key (the API_KEY set on your backend; saved in this browser only)"
          value={apiKey}
          onChange={(e) => saveKey(e.target.value)}
          autoComplete="off"
        />
      </form>

      {error ? (
        <div className="card p-8 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : !sources ? (
        <div className="card h-32 animate-pulse bg-slate-100 dark:bg-slate-900" />
      ) : sources.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">No sources yet. Add a Telegram channel above.</div>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.type === "telegram" && !/^-?\d+$/.test(s.identifier) ? "@" : ""}{s.identifier}</p>
                <p className="text-xs text-slate-500">
                  {s.type} · {s.last_checked_at ? `checked ${timeAgo(s.last_checked_at)}` : "not checked yet"}
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={s.enabled} disabled={busy} onChange={() => toggle(s)} />
                Enabled
              </label>
            </li>
          ))}
        </ul>
      )}

      {!DEMO && (
        <button className="btn-ghost" onClick={fetchNow} disabled={busy}>
          Fetch now
        </button>
      )}
    </div>
  );
}
