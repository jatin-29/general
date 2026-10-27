export interface Envelope {
  v: number;
  iter: number;
  salt: string;
  nonce: string;
  data: string;
  updated_at?: string | null;
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Decrypts what alerts/core.py `encrypt_payload` wrote: PBKDF2-SHA256 -> AES-256-GCM. Throws on a wrong password. */
export async function decryptEnvelope<T>(env: Envelope, password: string): Promise<T> {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot decrypt (needs HTTPS).");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(env.salt), iterations: env.iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.nonce) }, key, fromB64(env.data));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
