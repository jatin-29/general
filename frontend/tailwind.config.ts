import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// The indigo shades follow CSS variables so the accent can change (e.g. to match Spotify album art).
const accent = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        indigo: {
          ...colors.indigo,
          400: accent("--accent-light"),
          500: accent("--accent"),
          600: accent("--accent"),
          700: accent("--accent-dark"),
        },
      },
      fontFamily: { sans: ['"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"] },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "none" } },
        "pop-in": { from: { opacity: "0", transform: "scale(.96) translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        drift: {
          "0%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(6vw,-4vh,0) scale(1.15)" },
          "100%": { transform: "translate3d(-5vw,5vh,0) scale(.95)" },
        },
        eq: { "0%,100%": { transform: "scaleY(.3)" }, "50%": { transform: "scaleY(1)" } },
        ping: { "75%,100%": { transform: "scale(2.2)", opacity: "0" } },
      },
      animation: {
        "fade-up": "fade-up .55s cubic-bezier(.2,.7,.2,1) both",
        "pop-in": "pop-in .3s cubic-bezier(.2,.8,.2,1) both",
        drift: "drift 26s ease-in-out infinite alternate",
        eq: "eq 1s ease-in-out infinite",
        ping: "ping 1.6s cubic-bezier(0,0,.2,1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
