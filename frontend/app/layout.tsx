import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import ThemeToggle from "@/components/ThemeToggle";
import SpotifyWidget from "@/components/SpotifyWidget";
import { DEMO } from "@/lib/demo";
import { JOBS_MODE } from "@/lib/mode";

export const metadata: Metadata = {
  title: "OpeningsHub",
  description: "Off-campus job and internship openings from Telegram and YouTube in one place.",
};

const themeScript = `try{var t=localStorage.getItem('theme');if(t!=='light')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastProvider>
          <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
          <header className="sticky top-0 z-40 animate-fade-up border-b border-slate-500/15 bg-[rgb(var(--bg)/0.55)] backdrop-blur-xl">
            <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
              <Link href="/" className="text-lg font-bold tracking-tight">
                Openings<span className="gradient-text">Hub</span>
              </Link>
              <nav className="ml-auto flex items-center gap-2 text-sm">
                {!JOBS_MODE && (
                  <>
                <Link href="/" className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Dashboard
                </Link>
                <Link href="/add" className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Add
                </Link>
                <Link href="/sources" className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Sources
                </Link>
                <Link href="/settings" className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Settings
                </Link>
                  </>
                )}
                <ThemeToggle />
              </nav>
            </div>
          </header>
          {DEMO && !JOBS_MODE && (
            <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Demo mode: showing sample data. Connect a backend (set <code>API_URL</code>) to see real openings.
            </div>
          )}
          <main className="mx-auto max-w-4xl px-4 pb-28 pt-6">{children}</main>
          <SpotifyWidget />
        </ToastProvider>
      </body>
    </html>
  );
}
