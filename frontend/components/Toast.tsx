"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "error" | "success";
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

const ToastContext = createContext<(message: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, kind: Kind = "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
              t.kind === "error" ? "bg-red-600" : "bg-emerald-600"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              aria-label="Dismiss"
              className="opacity-70 hover:opacity-100"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
