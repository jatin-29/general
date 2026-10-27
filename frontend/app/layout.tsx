import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import ThemeToggle from "@/components/ThemeToggle";
import { DEMO } from "@/lib/demo";

export const metadata: Metadata = {
  title: "OpeningsHub",
  description: "Off-campus job and internship openings from Telegram, WhatsApp and YouTube in one place.",
};

const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastProvider>
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
            <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
              <Link href="/" className="text-lg font-bold tracking-tight">
                Openings<span className="text-indigo-600">Hub</span>
              </Link>
              <nav className="ml-auto flex items-center gap-2 text-sm">
                <Link href="/" className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Dashboard
                </Link>
                <Link href="/upload" className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Upload
                </Link>
                <ThemeToggle />
              </nav>
            </div>
          </header>
          {DEMO && (
            <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Demo mode: showing sample data. Connect a backend (set <code>API_URL</code>) to see real openings.
            </div>
          )}
          <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
