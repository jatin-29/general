import { DEMO, demoOpening, demoOpenings, demoSetApplied, demoSources } from "./demo";

export { DEMO };
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type EmploymentType = "internship" | "full-time" | "contract";
export type SourceType = "telegram" | "youtube";
export type OpeningSource = SourceType | "manual";

export interface Source {
  id: number;
  type: SourceType;
  identifier: string;
  name: string | null;
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
  source_type: OpeningSource;
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

export interface Setting {
  key: string;
  secret: boolean;
  is_set: boolean;
  origin: "website" | "environment" | null;
  value: string | null;
}

export interface TelegramChat {
  id: number;
  name: string;
  username: string | null;
  kind: "group" | "channel";
  identifier: string;
}

export interface NewOpening {
  company: string;
  role: string;
  location?: string;
  employment_type?: EmploymentType | "";
  eligibility?: string;
  deadline?: string;
  apply_link?: string;
  notes?: string;
}

export interface Extraction {
  is_opening: boolean;
  company: string | null;
  role: string | null;
  location: string | null;
  employment_type: EmploymentType | null;
  eligibility: string | null;
  deadline: string | null;
  apply_link: string | null;
}

/** The backend's API_KEY, entered once in Settings and kept in this browser only. */
export function getAdminKey(): string {
  try {
    return localStorage.getItem("api_key") ?? "";
  } catch {
    return "";
  }
}
export function setAdminKey(key: string) {
  try {
    localStorage.setItem("api_key", key);
  } catch {}
}

const DEMO_MSG = "This is a demo with sample data. Connect a backend (set API_URL) to use this.";

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d: { msg: string }) => d.msg).join("; ");
  } catch {}
  return `Request failed (${res.status})`;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  const key = getAdminKey();
  if (key) headers["X-API-Key"] = key;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("Cannot reach the server. Is the backend running?", 0);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

const demoBlocked = <T,>(): Promise<T> => Promise.reject(new ApiError(DEMO_MSG, 0));
const write = <T,>(path: string, method: string, json?: unknown): Promise<T> =>
  DEMO ? demoBlocked<T>() : request<T>(path, { method, json });

// ---- openings
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
  DEMO ? Promise.resolve(demoSetApplied(id, applied)) : write<Opening>(`/api/openings/${id}`, "PATCH", { applied });

const clean = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null));

export const createOpening = (o: NewOpening) => write<Opening>("/api/openings", "POST", clean(o));
export const deleteOpening = (id: number) => write<void>(`/api/openings/${id}`, "DELETE");
export const extractPost = (text: string) => write<Extraction>("/api/extract", "POST", { text });

// ---- sources
export const getSources = () => (DEMO ? Promise.resolve(demoSources()) : request<Source[]>("/api/sources"));
export const createSource = (type: SourceType, identifier: string, name?: string) =>
  write<Source>("/api/sources", "POST", clean({ type, identifier, name }));
export const setSourceEnabled = (id: number, enabled: boolean) => write<Source>(`/api/sources/${id}`, "PATCH", { enabled });
export const deleteSource = (id: number) => write<void>(`/api/sources/${id}`, "DELETE");
export const scrapeNow = () => write<{ new_items: number; openings: number; errors: number }>("/api/scrape/now", "POST");

// ---- settings & Telegram login
export const getSettings = () => write<Setting[]>("/api/settings", "GET");
export const saveSettings = (values: Record<string, string>) => write<Setting[]>("/api/settings", "PUT", { values });
export const telegramStatus = () => write<{ has_credentials: boolean; connected: boolean }>("/api/telegram/status", "GET");
export const telegramSendCode = (phone: string) => write<{ ok: true }>("/api/telegram/send-code", "POST", { phone });
export const telegramSignIn = (code: string, password?: string) =>
  write<{ connected: boolean; needs_password: boolean }>("/api/telegram/sign-in", "POST", { code, password: password || undefined });
export const telegramChats = () => write<TelegramChat[]>("/api/telegram/chats", "GET");
