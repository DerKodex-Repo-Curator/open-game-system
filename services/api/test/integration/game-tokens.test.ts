import { SELF } from "cloudflare:test";
import { GameTokenSchema } from "@open-game-system/ogs-protocol";
import { createOgsVerifier } from "@open-game-system/profile-kit/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { befriend } from "./friends-helpers";
import {
  BASE,
  bearer,
  type CreatedProfile,
  createProfile,
  createSession,
  ErrorSchema,
  joinSession,
} from "./helpers";

/** Games know who you are (slice 3), end to end in workerd, verified with profile-kit. */
const JWKS = "https://api.test/.well-known/jwks.json";
const verifier = () => createOgsVerifier({ jwksUrl: JWKS, fetch: (url) => SELF.fetch(url) });
const GrantSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
  profile: z.object({ id: z.string(), handle: z.string(), name: z.string(), avatar: z.string() }),
});
const SessionGrantSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
  players: z.array(
    z.object({ id: z.string(), handle: z.string(), name: z.string(), avatar: z.string() }),
  ),
});
const payloadOf = (token: string): Record<string, unknown> =>
  z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))));

async function gameToken(who: CreatedProfile, appId: string) {
  return SELF.fetch(`${BASE}/games/${appId}/token`, { method: "POST", headers: bearer(who.token) });
}

describe("GET /.well-known/jwks.json", () => {
  it("one ES256 P-256 public key with a kid, no private part", async () => {
    const res = await SELF.fetch(JWKS);
    expect(res.status).toBe(200);
    const { keys } = z
      .object({ keys: z.array(z.record(z.string(), z.unknown())) })
      .parse(await res.json());
    expect(keys).toEqual([
      {
        kty: "EC",
        crv: "P-256",
        x: expect.any(String),
        y: expect.any(String),
        kid: "k-integration",
        alg: "ES256",
        use: "sig",
      },
    ]);
  });
});

describe("POST /games/:appId/token", () => {
  it("a game gets the profile id, @id, name and avatar, verifiable with OGS's public key", async () => {
    const juneau = await createProfile({ name: "Juneau", sticker: "dragon" });
    const res = await gameToken(juneau, "rocket-crew");
    expect(res.status).toBe(200);
    const grant = GrantSchema.parse(await res.json());
    const avatar = "https://tv.test/art/story-nook/char-dragon.webp";
    expect(grant.profile).toEqual({
      id: juneau.profile.id,
      handle: juneau.profile.handle,
      name: "Juneau",
      avatar,
    });
    const claims = await verifier()(grant.token, "rocket-crew");
    expect(claims).toMatchObject({
      aud: "rocket-crew",
      sub: juneau.profile.id,
      name: "Juneau",
      avatar,
    });
    expect(GameTokenSchema.parse(claims).exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(
      3600,
    );
  });

  it("game A's token is rejected by game B", async () => {
    const juneau = await createProfile({ name: "Juneau" });
    const storyNook = GrantSchema.parse(await (await gameToken(juneau, "story-nook")).json());
    const verify = verifier();
    expect(await verify(storyNook.token, "story-nook")).not.toBeNull();
    expect(await verify(storyNook.token, "rocket-crew")).toBeNull();
  });

  it("the token never carries friends, age, device ids or the app's own token", async () => {
    const jonathan = await createProfile({ name: "Jonathan" });
    const juneau = await createProfile({ name: "Juneau", kind: "tablet" });
    await befriend(jonathan, juneau);
    const grant = GrantSchema.parse(await (await gameToken(juneau, "rocket-crew")).json());
    expect(Object.keys(payloadOf(grant.token)).sort()).toEqual([
      "aud",
      "avatar",
      "exp",
      "handle",
      "iat",
      "iss",
      "name",
      "sub",
    ]);
    const everything = JSON.stringify(grant);
    expect(everything).not.toContain(jonathan.profile.id);
    expect(everything).not.toContain(juneau.token);
    expect(grant.token).not.toBe(juneau.token);
  });

  it("an OGS app token is not a game token", async () => {
    const juneau = await createProfile();
    expect(await verifier()(juneau.token, "rocket-crew")).toBeNull();
  });

  it("an unknown game: 404 game_not_found", async () => {
    const juneau = await createProfile();
    const res = await gameToken(juneau, "not-a-game");
    expect(res.status).toBe(404);
    expect(ErrorSchema.parse(await res.json()).error.code).toBe("game_not_found");
  });
});

describe("POST /sessions/:sid/game-token — the TV page", () => {
  it("the launcher gets a token for the framed game with everyone on the couch", async () => {
    const jonathan = await createProfile({ name: "Jonathan", sticker: "bear" });
    const juneau = await createProfile({ name: "Juneau", sticker: "dragon", kind: "tablet" });
    const s = await createSession(jonathan);
    expect((await joinSession(juneau, s.code)).status).toBe(200);
    const res = await SELF.fetch(`${BASE}/sessions/${s.sessionId}/game-token`, {
      method: "POST",
      headers: bearer(s.token),
      body: JSON.stringify({ appId: "rocket-crew" }),
    });
    expect(res.status).toBe(200);
    const grant = SessionGrantSchema.parse(await res.json());
    expect(grant.players.map((p) => p.name)).toEqual(["Jonathan", "Juneau"]);
    const claims = await verifier()(grant.token, "rocket-crew");
    expect(claims).toMatchObject({
      sid: s.sessionId,
      sub: jonathan.profile.id,
      players: grant.players,
    });
    expect(grant.token).not.toBe(s.token);
  });

  it("a profile that hasn't joined is refused (403 not_a_member)", async () => {
    const jonathan = await createProfile();
    const max = await createProfile({ name: "Max" });
    const s = await createSession(jonathan);
    const res = await SELF.fetch(`${BASE}/sessions/${s.sessionId}/game-token`, {
      method: "POST",
      headers: bearer(max.token),
      body: JSON.stringify({ appId: "rocket-crew" }),
    });
    expect(res.status).toBe(403);
    expect(ErrorSchema.parse(await res.json()).error.code).toBe("not_a_member");
  });
});
