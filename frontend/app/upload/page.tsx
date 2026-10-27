"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { uploadWhatsApp, type UploadResult } from "@/lib/api";
import { useToast } from "@/components/Toast";

type Phase = "idle" | "uploading" | "processing" | "done";

export default function UploadPage() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [group, setGroup] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [fileName, setFileName] = useState("");

  async function handle(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) return toast("Please choose the exported chat as a .txt file");
    setFileName(file.name);
    setResult(null);
    setPct(0);
    setPhase("uploading");
    try {
      const res = await uploadWhatsApp(file, setPct, () => setPhase("processing"), group);
      setResult(res);
      setPhase("done");
      toast(`Found ${res.openings_found} new opening${res.openings_found === 1 ? "" : "s"}`, "success");
    } catch (e) {
      setPhase("idle");
      toast(e instanceof Error ? e.message : "Upload failed");
    }
  }

  const busy = phase === "uploading" || phase === "processing";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Upload WhatsApp export</h1>
        <p className="mt-1 text-sm text-slate-500">
          In WhatsApp open the group → ⋮ → More → Export chat → <em>Without media</em>, then drop the .txt file here.
          Re-uploading a newer export of the same group only adds new messages.
        </p>
      </div>

      <input
        className="input max-w-sm"
        placeholder="Group name (optional, defaults to file name)"
        aria-label="Group name"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        disabled={busy}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) handle(e.dataTransfer.files[0]);
        }}
        className={`card flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed p-12 text-center transition ${
          dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-slate-300 dark:border-slate-700"
        } ${busy ? "cursor-wait opacity-80" : ""}`}
      >
        <span className="text-3xl">📄</span>
        <p className="font-medium">{dragging ? "Drop to upload" : "Drag & drop a .txt file, or click to browse"}</p>
        <input ref={inputRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => handle(e.target.files?.[0])} />
      </div>

      {busy && (
        <div className="card space-y-2 p-4" aria-live="polite">
          <div className="flex justify-between text-sm">
            <span>{phase === "uploading" ? `Uploading ${fileName}…` : "Parsing messages and extracting openings…"}</span>
            {phase === "uploading" && <span>{pct}%</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full bg-indigo-600 transition-all ${phase === "processing" ? "w-full animate-pulse" : ""}`}
              style={phase === "uploading" ? { width: `${pct}%` } : undefined}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="card space-y-3 p-5">
          <h2 className="font-semibold">Done: {result.source_name}</h2>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Messages parsed", result.parsed_messages],
              ["New to process", result.new_items],
              ["Openings found", result.openings_found],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                <dd className="text-2xl font-bold">{n}</dd>
                <dt className="text-xs text-slate-500">{label}</dt>
              </div>
            ))}
          </dl>
          <Link href={`/?source=${encodeURIComponent(result.source_name)}`} className="btn-primary">
            View openings from this group
          </Link>
        </div>
      )}
    </div>
  );
}
