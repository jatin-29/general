"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button onClick={toggle} className="btn-ghost !px-2.5" aria-label="Toggle dark mode" title="Toggle dark mode">
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
