import { base64url } from "./base64url";

/**
 * Developers' push credentials at rest (ADR 2026-10-18-multi-tenant-push): AES-GCM with a key derived
 * from the Worker secret PUSH_KEY_SECRET and a purpose label (so it never equals the VAPID key's
 * derivation), a fresh 96-bit IV per value.
 */
const PURPOSE = "ogs-push-credentials-v1:";

async function boxKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PURPOSE + secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function seal(plain: string, secret: string): Promise<{ secretEnc: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await boxKey(secret), new TextEncoder().encode(plain));
  return { secretEnc: base64url(new Uint8Array(enc)), iv: base64url(iv) };
}

/** Throws when the value wasn't sealed with this secret. */
export async function open(sealed: { secretEnc: string; iv: string }, secret: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(sealed.iv) }, await boxKey(secret), fromB64url(sealed.secretEnc));
  return new TextDecoder().decode(plain);
}
