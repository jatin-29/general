/** When set, the site is a simple feed of collected jobs (data/jobs.json); otherwise the full backend dashboard. */
export const JOBS_URL = process.env.NEXT_PUBLIC_JOBS_URL ?? "";
export const JOBS_MODE = JOBS_URL !== "";
