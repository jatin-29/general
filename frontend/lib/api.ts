import { DEMO, demoOpening, demoOpenings, demoSetApplied, demoSources } from "./demo";

export { DEMO };
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type EmploymentType = "internship" | "full-time" | "contract";
export type SourceType = "telegram" | "youtube" | "whatsapp";

export interface Source {
  id: number;
  type: SourceType;
  identifier: string;
  enabled: boolean;
  last_checked_at: string | null;
}

export interface Opening {
  id: number;
  company: string;
  role: string;
  location: string | null;
  employment_type: EmploymentType | null;
  eligibility: string | null;
  deadline: string | null; // YYYY-MM-DD
  apply_link: string | null;
  source_type: SourceType;
  source_name: string;
  created_at: string;
  is_expired: boolean;
  applied: boolean;
}

export interface OpeningDetail extends Opening {
  raw_text: string;
  source_url: string | null;
}

export interface OpeningList {
  items: Opening[];
  total: number;
  page: number;
  limit: number;
}

export interface OpeningFilters {
  source?: string;
  type?: string;
  location?: string;
  search?: string;
  active_only?: boolean;
  hide_applied?: boolean;
  page?: number;
  limit?: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d: { msg: string }) => d.msg).join("; ");
  } catch {}
  return `Request failed (${res.status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("Cannot reach the server. Is the backend running?", 0);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json() as Promise<T>;
}

export function getOpenings(f: OpeningFilters): Promise<OpeningList> {
  if (DEMO) return Promise.resolve(demoOpenings(f));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  }
  return request(`/api/openings?${q}`);
}

export const getOpening = (id: number | string) => {
  if (DEMO) {
    const o = demoOpening(Number(id));
    return o ? Promise.resolve(o) : Promise.reject(new ApiError("Opening not found", 404));
  }
  return request<OpeningDetail>(`/api/openings/${id}`);
};

export const setApplied = (id: number, applied: boolean) =>
  DEMO ? Promise.resolve(demoSetApplied(id, applied)) : request<Opening>(`/api/openings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applied }),
  });

const DEMO_MSG = "Demo mode: connect a backend (set API_URL) to manage sources.";
const keyHeader = (apiKey: string) => ({ "Content-Type": "application/json", "X-API-Key": apiKey });

export const getSources = () => (DEMO ? Promise.resolve(demoSources()) : request<Source[]>("/api/sources"));

export const createSource = (type: SourceType, identifier: string, apiKey: string) =>
  DEMO
    ? Promise.reject(new ApiError(DEMO_MSG, 0))
    : request<Source>("/api/sources", { method: "POST", headers: keyHeader(apiKey), body: JSON.stringify({ type, identifier }) });

export const setSourceEnabled = (id: number, enabled: boolean, apiKey: string) =>
  DEMO
    ? Promise.reject(new ApiError(DEMO_MSG, 0))
    : request<Source>(`/api/sources/${id}`, { method: "PATCH", headers: keyHeader(apiKey), body: JSON.stringify({ enabled }) });

export const scrapeNow = (apiKey: string) =>
  DEMO
    ? Promise.reject(new ApiError(DEMO_MSG, 0))
    : request<{ new_items: number; openings: number; errors: number }>("/api/scrape/now", { method: "POST", headers: keyHeader(apiKey) });
