/** Parse YYYY-MM-DD as a local date (new Date("2025-01-01") would be UTC and can shift a day). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysUntil(deadline: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseDate(deadline).getTime() - today.getTime()) / 86_400_000);
}

export type Urgency = "expired" | "urgent" | "soon" | "ok" | "none";

export function deadlineBadge(deadline: string | null, expired: boolean): { label: string; urgency: Urgency } {
  if (!deadline) return { label: expired ? "Expired" : "No deadline", urgency: expired ? "expired" : "none" };
  const d = daysUntil(deadline);
  if (d < 0) return { label: "Expired", urgency: "expired" };
  if (d === 0) return { label: "Closing today", urgency: "urgent" };
  if (d === 1) return { label: "Closing tomorrow", urgency: "urgent" };
  if (d <= 3) return { label: `Closing in ${d} days`, urgency: "urgent" };
  if (d <= 7) return { label: `Closing in ${d} days`, urgency: "soon" };
  return { label: `Closing in ${d} days`, urgency: "ok" };
}

export function formatDate(s: string): string {
  return parseDate(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string): string {
  const secs = (Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
