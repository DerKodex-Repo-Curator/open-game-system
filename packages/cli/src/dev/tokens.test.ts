import { GameTokenSchema } from "@open-game-system/ogs-protocol";
import { verifyOgsToken } from "@open-game-system/profile-kit/server";
import { describe, expect, it } from "vitest";
import { createDevSigner } from "./tokens";

const jwksFetch = (jwks: unknown) => async () =>
  new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } });

const claims = (now: number, aud = "fixture-game") => ({
  iss: "http://localhost:4747",
  aud,
  sub: "dev-ada",
  handle: "ada",
  name: "Ada",
  avatar: "https://example.com/a.png",
  iat: Math.floor(now / 1000),
  exp: Math.floor(now / 1000) + 3600,
});

describe("ogs dev game tokens", { timeout: 20_000 }, () => {
  it("publishes only the public half of its ES256 key, with a kid", async () => {
    const signer = await createDevSigner();
    const { keys } = signer.jwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(keys[0].kid).toMatch(/^ogs-dev-/);
    expect(keys[0]).not.toHaveProperty("d");
  });

  it("makes a new key every run", async () => {
    const a = await createDevSigner();
    const b = await createDevSigner();
    expect(a.jwks().keys[0].kid).not.toBe(b.jwks().keys[0].kid);
    expect(a.jwks().keys[0].x).not.toBe(b.jwks().keys[0].x);
  });

  it("signs tokens profile-kit's verifyOgsToken accepts for that game", async () => {
    const signer = await createDevSigner();
    const now = Date.now();
    const token = await signer.sign(claims(now));
    const verified = await verifyOgsToken(token, {
      appId: "fixture-game",
      jwksUrl: "http://localhost:4747/.well-known/jwks.json",
      fetch: jwksFetch(signer.jwks()),
      now: () => now,
    });
    expect(verified).toEqual(GameTokenSchema.parse(claims(now)));
  });

  it("is rejected for another game, and by another run's key set", async () => {
    const signer = await createDevSigner();
    const other = await createDevSigner();
    const now = Date.now();
    const token = await signer.sign(claims(now));
    const opts = { jwksUrl: "http://x/jwks", now: () => now };
    expect(
      await verifyOgsToken(token, { ...opts, appId: "other", fetch: jwksFetch(signer.jwks()) }),
    ).toBeNull();
    expect(
      await verifyOgsToken(token, {
        ...opts,
        appId: "fixture-game",
        fetch: jwksFetch(other.jwks()),
      }),
    ).toBeNull();
  });

  it("puts alg, kid and typ in the header", async () => {
    const signer = await createDevSigner();
    const token = await signer.sign(claims(Date.now()));
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "ES256", kid: signer.jwks().keys[0].kid, typ: "JWT" });
  });
});
