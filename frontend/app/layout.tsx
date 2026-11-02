import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import MenuButton from "@/components/MenuButton";
import SpotifyWidget from "@/components/SpotifyWidget";

export const viewport = { themeColor: "#f6f1e9" };

export const metadata: Metadata = {
  title: "OpeningsHub",
  description: "Off-campus job and internship openings from Telegram and YouTube in one place.",
};

// Warm Paper (light) unless you picked dark with the moon button.
const themeScript = `try{if(localStorage.getItem('ui_theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ToastProvider>
          <div className="mesh" aria-hidden="true" />
          <header className="relative z-40 mx-auto grid max-w-6xl grid-cols-[3rem_1fr_3rem] items-center px-4 pt-4 animate-[fade-up_.6s_both]">
            <MenuButton />
            <Link href="/" className="font-display on-bg justify-self-center text-2xl font-bold tracking-tight">
              Openings<span className="text-brand-600 italic">Hub</span>
            </Link>
            <span />
          </header>
          <main className="mx-auto max-w-6xl px-4 pb-28 pt-4">{children}</main>
          <SpotifyWidget />
        </ToastProvider>
      </body>
    </html>
  );
}
