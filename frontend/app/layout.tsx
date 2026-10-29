import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import MenuButton from "@/components/MenuButton";
import SpotifyWidget from "@/components/SpotifyWidget";

export const viewport = { themeColor: "#4d5a4b" };

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
          <div className="mesh" aria-hidden="true"><i /><i /><i /></div>
          <header className="relative z-40 mx-auto grid max-w-6xl grid-cols-[3rem_1fr_3rem] items-center px-4 pt-4 animate-[fade-up_.6s_both]">
            <MenuButton />
            <Link href="/" className="font-display justify-self-center text-2xl font-black tracking-tight text-white drop-shadow-[0_2px_12px_rgba(90,40,170,.45)]">
              Openings<span className="opacity-80">Hub</span>
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
