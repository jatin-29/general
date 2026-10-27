/** Spotify "now playing", fully in the browser (Authorization Code flow with PKCE: no secret, no backend). */
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_URL = "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode";
export const SCOPES = "user-read-currently-playing user-read-playback-state";

const K_CLIENT = "spotify_client_id";
const K_TOKENS = "spotify_tokens";
const K_PKCE = "spotify_pkce";

export interface NowPlaying {
  isPlaying: boolean;
  title: string;
  artist: string;
  art: string | null;
  url: string | null;
  progressMs: number;
  durationMs: number;
  fetchedAt: number;
}
export type NowState = NowPlaying | "idle";

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {}
};

export const getClientId = () => get(K_CLIENT) ?? process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
export const setClientId = (id: string) => set(K_CLIENT, id.trim());
export const isConnected = () => get(K_TOKENS) !== null;

/** Must match, character for character, a Redirect URI added in the Spotify dashboard. */
export const redirectUri = () => `${location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;

// ---------------------------------------------------------------- PKCE helpers
export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(len = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function challengeFor(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

// ---------------------------------------------------------------- login
export async function startLogin(clientId: string): Promise<void> {
  setClientId(clientId);
  const verifier = randomString(96);
  const state = randomString(24);
  set(K_PKCE, JSON.stringify({ verifier, state }));
  const q = new URLSearchParams({
    client_id: clientId.trim(),
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: await challengeFor(verifier),
    state,
    scope: SCOPES,
  });
  location.assign(`${AUTH_URL}?${q}`);
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: getClientId(), ...body }),
  });
  if (!res.ok) throw new Error(`Spotify token error (${res.status})`);
  const j = await res.json();
  const prev = get(K_TOKENS);
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? (prev ? (JSON.parse(prev) as Tokens).refresh_token : ""),
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 - 30_000,
  };
}

/** Call on page load: if Spotify just sent us back with ?code=, finish the login. Returns "connected", "error" or null. */
export async function completeLogin(): Promise<"connected" | "error" | null> {
  const p = new URLSearchParams(location.search);
  const code = p.get("code");
  const err = p.get("error");
  if (!code && !err) return null;
  const saved = get(K_PKCE);
  set(K_PKCE, null);
  const clean = () => history.replaceState(null, "", location.pathname + location.hash);
  if (err || !code || !saved) {
    clean();
    return "error";
  }
  const { verifier, state } = JSON.parse(saved) as { verifier: string; state: string };
  if (p.get("state") !== state) {
    clean();
    return "error";
  }
  try {
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    set(K_TOKENS, JSON.stringify(tokens));
    clean();
    return "connected";
  } catch {
    clean();
    return "error";
  }
}

export function disconnect() {
  set(K_TOKENS, null);
  set(K_PKCE, null);
}

async function accessToken(force = false): Promise<string> {
  const raw = get(K_TOKENS);
  if (!raw) throw new Error("not connected");
  let t = JSON.parse(raw) as Tokens;
  if (force || Date.now() >= t.expires_at) {
    if (!t.refresh_token) throw new Error("expired");
    try {
      t = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    } catch {
      disconnect();
      throw new Error("expired");
    }
    set(K_TOKENS, JSON.stringify(t));
  }
  return t.access_token;
}

// ---------------------------------------------------------------- now playing
export class RateLimited extends Error {
  constructor(public retryAfterMs: number) {
    super("rate limited");
  }
}

export function parseNowPlaying(j: any, now = Date.now()): NowState {
  const item = j?.item;
  if (!item) return "idle"; // ads or private session
  const isEpisode = item.type === "episode";
  const images: { url: string }[] = (isEpisode ? item.images : item.album?.images) ?? [];
  return {
    isPlaying: !!j.is_playing,
    title: item.name ?? "",
    artist: isEpisode ? item.show?.name ?? "" : (item.artists ?? []).map((a: { name: string }) => a.name).join(", "),
    art: (images[1] ?? images[0])?.url ?? null,
    url: item.external_urls?.spotify ?? null,
    progressMs: j.progress_ms ?? 0,
    durationMs: item.duration_ms ?? 0,
    fetchedAt: now,
  };
}

export async function fetchNowPlaying(): Promise<NowState> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(NOW_URL, { headers: { Authorization: `Bearer ${await accessToken(attempt > 0)}` } });
    if (res.status === 204) return "idle";
    if (res.status === 401 && attempt === 0) continue; // token rejected: refresh once and retry
    if (res.status === 429) throw new RateLimited((Number(res.headers.get("Retry-After")) || 5) * 1000);
    if (!res.ok) throw new Error(`Spotify error (${res.status})`);
    return parseNowPlaying(await res.json());
  }
  throw new Error("expired");
}
