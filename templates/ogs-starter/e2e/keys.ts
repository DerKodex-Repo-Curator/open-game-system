/** An ES256 key pair shaped like OGS's: the tests sign game tokens, the Worker verifies them. */
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

export const KID = "test-key";

export async function newKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const jwks = {
    keys: [{ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid: KID, alg: "ES256", use: "sig" }],
  };
  return { jwks, privateJwk: priv };
}

/** Sign a game token the way the OGS API does. */
export async function signGameToken(privateJwk: JsonWebKey, claims: Record<string, unknown>) {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const input = `${b64urlJson({ alg: "ES256", kid: KID, typ: "JWT" })}.${b64urlJson(claims)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

export function gameClaims(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://ogs.test",
    aud: "ogs-starter",
    sub: "u-sam",
    handle: "sam",
    name: "Sam",
    avatar: "https://example.com/sam.png",
    iat: now,
    exp: now + 3600,
    ...over,
  };
}
