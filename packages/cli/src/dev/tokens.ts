import { randomUUID, webcrypto } from "node:crypto";
import type { GameToken } from "@open-game-system/ogs-protocol";

/** One public key as `/.well-known/jwks.json` lists it (the shape the OGS API serves). */
export type PublicJwk = {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg: "ES256";
  use: "sig";
};

export type DevSigner = {
  jwks(): { keys: PublicJwk[] };
  sign(claims: GameToken): Promise<string>;
};

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

/**
 * The fake OGS signer `ogs dev` makes for one run: a fresh P-256 key (never written anywhere), its
 * public half for `/.well-known/jwks.json`, and ES256 game tokens shaped like the OGS API's.
 */
export async function createDevSigner(): Promise<DevSigner> {
  const kid = `ogs-dev-${randomUUID().slice(0, 8)}`;
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk: PublicJwk = {
    kty: jwk.kty ?? "EC",
    crv: jwk.crv ?? "P-256",
    x: jwk.x ?? "",
    y: jwk.y ?? "",
    kid,
    alg: "ES256",
    use: "sig",
  };
  return {
    jwks: () => ({ keys: [publicJwk] }),
    async sign(claims) {
      const input = `${b64urlJson({ alg: "ES256", kid, typ: "JWT" })}.${b64urlJson(claims)}`;
      const sig = await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        Uint8Array.from(new TextEncoder().encode(input)),
      );
      return `${input}.${b64url(new Uint8Array(sig))}`;
    },
  };
}
