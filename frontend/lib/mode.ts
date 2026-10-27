/** When set, the site is a simple feed of collected jobs (data/jobs.json); otherwise the full backend dashboard. */
export const JOBS_URL = process.env.NEXT_PUBLIC_JOBS_URL ?? "";
export const JOBS_MODE = JOBS_URL !== "";
/** Same file through GitHub's API: refreshed within about a minute (raw.githubusercontent caches about 5). */
export const JOBS_API_URL = process.env.NEXT_PUBLIC_JOBS_API_URL ?? "";
