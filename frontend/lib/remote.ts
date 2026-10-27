/** Permanent delete: the site asks the collector workflow (which holds the password) to remove a job. */
const REPO = process.env.NEXT_PUBLIC_GH_REPO ?? "";
const BRANCH = process.env.NEXT_PUBLIC_GH_BRANCH ?? "main";
const K_TOKEN = "gh_actions_token";
const K_PENDING = "jobs_delete_pending";
export const RETRY_MS = 6 * 60_000; // still in the data after this long -> ask again

export const remoteDeleteAvailable = REPO !== "";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {}
};

/** GitHub token with "Actions: Read and write" on this repo only (the same one cron-job.org uses). */
export const getToken = () => read(K_TOKEN) ?? "";
export const setToken = (t: string) => write(K_TOKEN, t.trim() || null);

/** Job id -> when the delete was last requested. Hidden on this device until the job is gone from the data. */
export function getPending(): Record<string, number> {
  try {
    return JSON.parse(read(K_PENDING) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
export const setPending = (p: Record<string, number>) => write(K_PENDING, Object.keys(p).length ? JSON.stringify(p) : null);

export class TokenRejected extends Error {}

export async function dispatchDelete(ids: string[], token: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/alerts.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: BRANCH, inputs: { delete: ids.join(",") } }),
    });
  } catch {
    throw new Error("Could not reach GitHub. Check your connection.");
  }
  if (res.status === 204) return;
  if ([401, 403, 404].includes(res.status)) throw new TokenRejected(`GitHub did not accept the key (${res.status}).`);
  throw new Error(`GitHub error (${res.status}).`);
}
