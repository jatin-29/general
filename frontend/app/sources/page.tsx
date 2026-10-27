"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSource, deleteSource, getSources, scrapeNow, setSourceEnabled, telegramChats,
  type Source, type TelegramChat,
} from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { timeAgo } from "@/lib/format";
import { useToast } from "@/components/Toast";

export default function SourcesPage() {
  const toast = useToast();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [chats, setChats] = useState<TelegramChat[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [chatFilter, setChatFilter] = useState("");
  const [tgHandle, setTgHandle] = useState("");
  const [ytRef, setYtRef] = useState("");

  const load = useCallback(() => {
    getSources().then((s) => { setSources(s); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(load, [load]);

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

  const existing = useMemo(() => new Set((sources ?? []).filter((s) => s.type === "telegram").map((s) => s.identifier)), [sources]);
  const visibleChats = (chats ?? []).filter((c) => `${c.name} ${c.username ?? ""}`.toLowerCase().includes(chatFilter.toLowerCase()));

  async function loadChats() {
    const r = await run(telegramChats);
    if (r) {
      setChats(r);
      if (!r.length) toast("No groups or channels found on this account");
    }
  }

  async function addPicked() {
    const toAdd = (chats ?? []).filter((c) => picked.has(c.identifier) && !existing.has(c.identifier));
    setBusy(true);
    let added = 0;
    for (const c of toAdd) {
      try {
        await createSource("telegram", c.identifier, c.name);
        added++;
      } catch (e) {
        toast(`${c.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setBusy(false);
    if (added) toast(`Added ${added} source${added > 1 ? "s" : ""}`, "success");
    setPicked(new Set());
    load();
  }

  async function addHandle(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => createSource("telegram", tgHandle.trim()), "Source added")) {
      setTgHandle("");
      load();
    }
  }

  async function addYoutube(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => createSource("youtube", ytRef.trim()), "Channel added")) {
      setYtRef("");
      load();
    }
  }

  async function fetchNow() {
    const r = await run(scrapeNow);
    if (r) {
      toast(`Fetched ${r.new_items} new posts, found ${r.openings} openings${r.errors ? `. ${r.errors} source(s) failed, see server logs` : ""}`, r.errors ? "error" : "success");
      load();
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Sources</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose which Telegram groups/channels and YouTube channels to read. Only these are checked, every 5 minutes. Set up your keys in <Link href="/settings" className="text-indigo-600 underline dark:text-indigo-400">Settings</Link> first.
        </p>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Telegram</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={loadChats} disabled={busy}>
            {chats ? "Reload my chats" : "Pick from my Telegram chats"}
          </button>
        </div>

        {chats && (
          <div className="space-y-2">
            <input className="input" placeholder="Filter chats…" value={chatFilter} onChange={(e) => setChatFilter(e.target.value)} />
            <ul className="max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {visibleChats.map((c) => {
                const added = existing.has(c.identifier);
                return (
                  <li key={c.id}>
                    <label className={`flex items-center gap-3 px-3 py-2 text-sm ${added ? "opacity-50" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-indigo-600"
                        disabled={added}
                        checked={added || picked.has(c.identifier)}
                        onChange={(e) => {
                          const n = new Set(picked);
                          e.target.checked ? n.add(c.identifier) : n.delete(c.identifier);
                          setPicked(n);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-slate-500">{added ? "added" : c.kind}</span>
                    </label>
                  </li>
                );
              })}
              {!visibleChats.length && <li className="px-3 py-4 text-center text-sm text-slate-500">No matches</li>}
            </ul>
            <button className="btn-primary" disabled={busy || picked.size === 0} onClick={addPicked}>
              Add selected ({picked.size})
            </button>
          </div>
        )}

        <form onSubmit={addHandle} className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <input className="input" placeholder="Or add a public channel: @username or t.me link" value={tgHandle} onChange={(e) => setTgHandle(e.target.value)} />
          <button className="btn-ghost" disabled={busy || !tgHandle.trim()}>Add</button>
        </form>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">YouTube channels</h2>
        <form onSubmit={addYoutube} className="flex gap-2">
          <input className="input" placeholder="Channel URL, @handle or channel id" value={ytRef} onChange={(e) => setYtRef(e.target.value)} />
          <button className="btn-primary" disabled={busy || !ytRef.trim()}>Add</button>
        </form>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Your sources</h2>
          {!DEMO && <button className="btn-ghost" onClick={fetchNow} disabled={busy || !sources?.length}>Fetch now</button>}
        </div>
        {error ? (
          <div className="card p-6 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : !sources ? (
          <div className="card h-24 animate-pulse bg-slate-100 dark:bg-slate-900" />
        ) : sources.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-500">Nothing added yet.</div>
        ) : (
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id} className="card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name ?? s.identifier}</p>
                  <p className="text-xs text-slate-500">
                    {s.type} · {s.last_checked_at ? `checked ${timeAgo(s.last_checked_at)}` : "not checked yet"}
                  </p>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-600"
                    checked={s.enabled}
                    disabled={busy}
                    onChange={async () => (await run(() => setSourceEnabled(s.id, !s.enabled))) && load()}
                  />
                  On
                </label>
                <button
                  className="btn-ghost !px-2.5 text-red-600"
                  aria-label={`Remove ${s.name ?? s.identifier}`}
                  disabled={busy}
                  onClick={async () => confirm(`Remove ${s.name ?? s.identifier}? Openings already found are kept.`) && (await run(() => deleteSource(s.id), "Removed")) && load()}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
