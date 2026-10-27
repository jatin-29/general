import { DEMO, demoOpening, demoOpenings, demoSetApplied } from "./demo";

export { DEMO };
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type EmploymentType = "internship" | "full-time" | "contract";
export type SourceType = "telegram" | "youtube" | "whatsapp";

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

export interface UploadResult {
  source_name: string;
  parsed_messages: number;
  new_items: number;
  openings_found: number;
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

/** Upload with real upload-progress events (fetch can't report them). */
export function uploadWhatsApp(
  file: File,
  onProgress: (pct: number) => void,
  onUploaded: () => void,
  groupName?: string,
): Promise<UploadResult> {
  if (DEMO) return Promise.reject(new ApiError("Uploads need a backend. This is a demo with sample data.", 0));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/upload/whatsapp`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = onUploaded;
    xhr.onerror = () => reject(new ApiError("Cannot reach the server. Is the backend running?", 0));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as UploadResult);
      const detail = typeof body?.detail === "string" ? body.detail : `Upload failed (${xhr.status})`;
      reject(new ApiError(detail, xhr.status));
    };
    const form = new FormData();
    form.append("file", file);
    if (groupName?.trim()) form.append("group_name", groupName.trim());
    xhr.send(form);
  });
}
