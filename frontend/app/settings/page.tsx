"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEMO, getAdminKey, getSettings, saveSettings, setAdminKey, telegramSendCode, telegramSignIn, telegramStatus,
  type Setting,
} from "@/lib/api";
import { useToast } from "@/components/Toast";

const LABELS: Record<string, { label: string; hint?: string }> = {
  anthropic_api_key: { label: "Anthropic API key", hint: "console.anthropic.com → API keys. Used to read posts and pull out company, role, deadline, etc." },
  anthropic_model: { label: "Model (optional)", hint: "Default: claude-haiku-4-5 (cheapest)" },
  telegram_api_id: { label: "Telegram API ID", hint: "my.telegram.org → API development tools" },
  telegram_api_hash: { label: "Telegram API hash" },
  youtube_api_key: { label: "YouTube Data API key (optional)", hint: "Fallback when YouTube's RSS feed is unavailable, and fetches full descriptions. Free quota." },
  telegram_bot_token: { label: "Telegram bot token (optional)", hint: "From @BotFather. Pushes new openings to your chat." },
  telegram_notify_chat_id: { label: "Your chat id for notifications (optional)" },
};

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const [adminKey, setKey] = useState("");
  const [settings, setSettings] = useState<Record<string, Setting> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tg, setTg] = useState<{ has_credentials: boolean; connected: boolean } | null>(null);
  const [step, setStep] = useState<"idle" | "code" | "password">("idle");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await getSettings();
      setSettings(Object.fromEntries(list.map((s) => [s.key, s])));
      setTg(await telegramStatus());
      setLoadError(null);
    } catch (e) {
      setSettings(null);
      setLoadError(e instanceof Error ? e.message : "Failed to load settings");
    }
  }, []);

  useEffect(() => {
    setKey(getAdminKey());
    if (!DEMO) load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, "success");
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(keys: string[]) {
    const values = Object.fromEntries(keys.filter((k) => draft[k] !== undefined && draft[k] !== "").map((k) => [k, draft[k]]));
    if (!Object.keys(values).length) return toast("Nothing to save");
    if (await run(() => saveSettings(values), "Saved")) {
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
      load();
    }
  }

  async function clear(key: string) {
    if (await run(() => saveSettings({ [key]: "" }), "Cleared")) load();
  }

  function Field({ k }: { k: string }) {
    const meta = LABELS[k];
    const s = settings?.[k];
    const placeholder = s?.secret ? (s.is_set ? "•••••••• saved (type to replace)" : "Not set") : s?.value || "Not set";
    return (
      <label className="block space-y-1">
        <span className="text-sm font-medium">{meta.label}</span>
        <div className="flex gap-2">
          <input
            className="input"
            type={s?.secret ? "password" : "text"}
            autoComplete="off"
            placeholder={placeholder}
            value={draft[k] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
          />
          {s?.origin === "website" && (
            <button type="button" className="btn-ghost" onClick={() => clear(k)} disabled={busy}>
              Clear
            </button>
          )}
        </div>
        {meta.hint && <span className="block text-xs text-slate-500">{meta.hint}</span>}
        {s?.origin === "environment" && <span className="block text-xs text-emerald-600">Set on the server (environment variable)</span>}
      </label>
    );
  }

  async function sendCode() {
    if (await run(() => telegramSendCode(phone.trim()), "Code sent. Check your Telegram app.")) setStep("code");
  }

  async function verify() {
    setBusy(true);
    try {
      const r = await telegramSignIn(code.trim(), password);
      if (r.needs_password) {
        setStep("password");
        toast("Two-step verification is on. Enter your Telegram password.", "success");
      } else {
        toast("Telegram connected", "success");
        setStep("idle");
        setCode("");
        setPassword("");
        load();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Everything needed to collect openings is configured here. Nothing is stored in the website itself; values go to your backend.</p>
      </div>

      <Section title="1. Admin key" note="The API_KEY set on your backend. It's saved only in this browser and protects everything that changes data or costs money.">
        <div className="flex gap-2">
          <input className="input" type="password" autoComplete="off" placeholder="Admin key" value={adminKey} onChange={(e) => setKey(e.target.value)} />
          <button className="btn-primary" disabled={busy || DEMO} onClick={() => { setAdminKey(adminKey.trim()); load(); toast("Key saved", "success"); }}>
            Save
          </button>
        </div>
        {loadError && !DEMO && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      </Section>

      {settings && (
        <>
          <Section title="2. AI extraction" note="Required. Without it, posts are stored but never turned into openings. Pay-per-use; batches 10 posts per request to keep cost low.">
            <Field k="anthropic_api_key" />
            <Field k="anthropic_model" />
            <button className="btn-primary" disabled={busy} onClick={() => save(["anthropic_api_key", "anthropic_model"])}>Save</button>
          </Section>

          <Section title="3. Telegram" note="Reads only the groups/channels you pick on the Sources page, using your own Telegram account.">
            <Field k="telegram_api_id" />
            <Field k="telegram_api_hash" />
            <button className="btn-primary" disabled={busy} onClick={() => save(["telegram_api_id", "telegram_api_hash"])}>Save credentials</button>

            <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
              <p className="mb-2 text-sm font-medium">
                Login status:{" "}
                {tg?.connected ? <span className="text-emerald-600">Connected ✓</span> : <span className="text-amber-600">Not connected</span>}
              </p>
              {!tg?.has_credentials ? (
                <p className="text-xs text-slate-500">Save your API ID and hash first.</p>
              ) : step === "idle" ? (
                <div className="flex gap-2">
                  <input className="input" placeholder="Phone with country code, e.g. +911234567890" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <button className="btn-primary whitespace-nowrap" disabled={busy || phone.trim().length < 6} onClick={sendCode}>
                    {tg.connected ? "Log in again" : "Send code"}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input className="input" placeholder="Code from Telegram" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
                  {step === "password" && (
                    <input className="input" type="password" placeholder="Two-step verification password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  )}
                  <div className="flex gap-2">
                    <button className="btn-primary" disabled={busy || !code.trim()} onClick={verify}>Verify</button>
                    <button className="btn-ghost" onClick={() => setStep("idle")}>Cancel</button>
                  </div>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">Your login is stored on your backend only. Anyone with access to it can read your Telegram, so keep the admin key private.</p>
            </div>
          </Section>

          <Section title="4. Optional extras">
            <Field k="youtube_api_key" />
            <Field k="telegram_bot_token" />
            <Field k="telegram_notify_chat_id" />
            <button className="btn-primary" disabled={busy} onClick={() => save(["youtube_api_key", "telegram_bot_token", "telegram_notify_chat_id"])}>Save</button>
          </Section>
        </>
      )}
    </div>
  );
}
