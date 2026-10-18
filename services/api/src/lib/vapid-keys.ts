import { base64url } from "./base64url";

/**
 * Per-game VAPID keys (spec §9): a P-256 pair per appId, made on first use. OGS sends every web
 * push, so it holds them; a game never sees or configures one. The private key is stored
 * AES-GCM encrypted under the Worker secret PUSH_KEY_SECRET.
 */
export interface VapidKeyPair {
  /** Raw uncompressed P-256 point (0x04 ‖ x ‖ y), base64url: the applicationServerKey. */
  publicKey: string;
  /** The private scalar `d`, base64url. */
  privateKey: string;
}

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** The AES-GCM key derived from the secret (SHA-256 of it). */
async function wrappingKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function newPair(): Promise<VapidKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  if (!("privateKey" in pair)) throw new Error("expected a P-256 key pair");
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (jwk instanceof ArrayBuffer) throw new Error("expected a JWK");
  const point = new Uint8Array([4, ...fromB64url(jwk.x ?? ""), ...fromB64url(jwk.y ?? "")]);
  return { publicKey: base64url(point), privateKey: jwk.d ?? "" };
}

type Row = { public_key: string; private_key_enc: string; iv: string };

/**
 * The game's VAPID keys, made and stored on first use. Null when PUSH_KEY_SECRET isn't set (web push
 * off). Throws if the stored key can't be decrypted with this secret.
 */
export async function vapidKeysFor(
  db: D1Database,
  appId: string,
  secret: string | undefined,
  now: number,
): Promise<VapidKeyPair | null> {
  if (!secret) return null;
  const key = await wrappingKey(secret);
  const row = await db
    .prepare("SELECT public_key, private_key_enc, iv FROM push_vapid_keys WHERE app_id = ?")
    .bind(appId)
    .first<Row>();
  if (row) {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(row.iv) },
      key,
      fromB64url(row.private_key_enc),
    );
    return { publicKey: row.public_key, privateKey: new TextDecoder().decode(plain) };
  }
  const pair = await newPair();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(pair.privateKey),
  );
  await db
    .prepare(
      `INSERT INTO push_vapid_keys (app_id, public_key, private_key_enc, iv, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(app_id) DO NOTHING`,
    )
    .bind(appId, pair.publicKey, base64url(new Uint8Array(enc)), base64url(iv), now)
    .run();
  // Two first uses at once: the stored pair wins.
  return vapidKeysFor(db, appId, secret, now);
}
