import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signJwt } from "../../src/lib/jwt";
import {
  BASE,
  bearer,
  CreatedProfileSchema,
  claimsOf,
  createProfile,
  createSession,
  device,
  ErrorSchema,
  json,
  MeSchema,
  unique,
} from "./helpers";

const HandleSchema = z.object({
  handle: z.string(),
  available: z.boolean(),
  suggestion: z.string(),
});
const postProfile = (body: unknown) =>
  SELF.fetch(`${BASE}/profiles`, { method: "POST", headers: json, body: JSON.stringify(body) });
const handles = async (query: string) => {
  const res = await SELF.fetch(`${BASE}/handles?${query}`);
  expect(res.status).toBe(200);
  return HandleSchema.parse(await res.json());
};
const errorCode = async (res: Response) => ErrorSchema.parse(await res.json()).error.code;

describe("GET /handles — the @id pre-fill", () => {
  it("makes first name + last initial from a full name", async () => {
    const tag = unique("x").replace(/[^a-z0-9]/g, "");
    expect(await handles(`name=${encodeURIComponent(`Jonathan ${tag}`)}`)).toEqual({
      handle: `jonathan.${tag[0]}`,
      available: true,
      suggestion: `jonathan.${tag[0]}`,
    });
  });

  it("uses a one-word name as is, lowercased and without accents or symbols", async () => {
    const r = await handles(`name=${encodeURIComponent("Zoë-Ann!")}`);
    expect(r.handle).toBe("zoeann");
  });

  it("normalises a typed handle (drops the @, lowercases)", async () => {
    const h = unique("Jonny").toLowerCase().replace(/-/g, "");
    expect((await handles(`handle=@${h.toUpperCase()}`)).handle).toBe(h);
  });

  it("says a taken handle is taken and suggests the next free one", async () => {
    const taken = unique("juneau").replace(/-/g, ".");
    await createProfile({ handle: taken });
    expect(await handles(`handle=${taken}`)).toEqual({
      handle: taken,
      available: false,
      suggestion: `${taken}2`,
    });
    await createProfile({ handle: `${taken}2` });
    expect((await handles(`handle=${taken}`)).suggestion).toBe(`${taken}3`);
  });

  it("needs a name or a handle (400 invalid_body)", async () => {
    const res = await SELF.fetch(`${BASE}/handles`);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_body");
  });
});

describe("POST /profiles — make your OGS profile on this device", () => {
  it("makes the profile and a token for this device", async () => {
    const handle = unique("jonathan").replace(/-/g, ".");
    const d = device("phone");
    const res = await postProfile({
      name: " Jonathan ",
      handle: `@${handle}`,
      sticker: "bear",
      device: d,
    });
    expect(res.status).toBe(201);
    const { profile, token } = CreatedProfileSchema.parse(await res.json());
    expect(profile).toEqual({ id: expect.any(String), handle, name: "Jonathan", sticker: "bear" });
    const claims = claimsOf(token);
    expect(claims).toEqual({
      sub: profile.id,
      did: d.deviceId,
      kind: "phone",
      exp: expect.any(Number),
    });
    const days = (claims.exp * 1000 - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);
  });

  it("a kid's iPad runs the same step and gets a tablet token, no sign-in", async () => {
    const p = await createProfile({ name: "Juneau", sticker: "dragon", kind: "tablet" });
    expect(claimsOf(p.token).kind).toBe("tablet");
    expect(p.profile.name).toBe("Juneau");
  });

  it("picks the handle from the name when none is given", async () => {
    const last = unique("q").replace(/[^a-z0-9]/g, "");
    const res = await postProfile({ name: `Mom ${last}`, sticker: "owl", device: device() });
    const { profile } = CreatedProfileSchema.parse(await res.json());
    expect(profile.handle).toMatch(/^mom\.[a-z0-9]\d*$/);
  });

  it("refuses a taken handle (409 handle_taken)", async () => {
    const p = await createProfile();
    const res = await postProfile({
      name: "Other",
      handle: p.profile.handle,
      sticker: "owl",
      device: device(),
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("handle_taken");
  });

  it.each([
    ["no name", { handle: "abc", sticker: "bear", device: device() }],
    ["an empty name", { name: "  ", sticker: "bear", device: device() }],
    ["no sticker", { name: "A", device: device() }],
    ["no device", { name: "A", sticker: "bear" }],
    [
      "a launcher device",
      { name: "A", sticker: "bear", device: { ...device(), kind: "launcher" } },
    ],
    ["a one-letter handle", { name: "A", handle: "a", sticker: "bear", device: device() }],
    ["a handle with spaces", { name: "A", handle: "a b c", sticker: "bear", device: device() }],
  ])("rejects %s (400 invalid_body)", async (_name, body) => {
    const res = await postProfile(body);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_body");
  });

  it("rejects a body that isn't JSON (400 invalid_body)", async () => {
    const res = await SELF.fetch(`${BASE}/profiles`, { method: "POST", headers: json, body: "{" });
    expect(res.status).toBe(400);
  });
});

describe("GET /me and PATCH /me", () => {
  it("returns the profile and no logins until it's backed up", async () => {
    const p = await createProfile({ name: "Jonathan", sticker: "bear" });
    const res = await SELF.fetch(`${BASE}/me`, { headers: bearer(p.token) });
    expect(res.status).toBe(200);
    expect(MeSchema.parse(await res.json())).toEqual({ profile: p.profile, logins: [] });
  });

  it("edits the name, handle and sticker", async () => {
    const p = await createProfile();
    const handle = unique("jon").replace(/-/g, ".");
    const res = await SELF.fetch(`${BASE}/me`, {
      method: "PATCH",
      headers: bearer(p.token),
      body: JSON.stringify({ name: "Jon", handle, sticker: "owl" }),
    });
    expect(res.status).toBe(200);
    const me = MeSchema.parse(await res.json());
    expect(me.profile).toEqual({ id: p.profile.id, name: "Jon", handle, sticker: "owl" });
    const again = MeSchema.parse(
      await (await SELF.fetch(`${BASE}/me`, { headers: bearer(p.token) })).json(),
    );
    expect(again.profile).toEqual(me.profile);
  });

  it("keeps fields that aren't sent, and its own handle is not 'taken'", async () => {
    const p = await createProfile({ name: "Jonathan", sticker: "bear" });
    const res = await SELF.fetch(`${BASE}/me`, {
      method: "PATCH",
      headers: bearer(p.token),
      body: JSON.stringify({ handle: p.profile.handle, name: "Jonny" }),
    });
    expect(MeSchema.parse(await res.json()).profile).toEqual({ ...p.profile, name: "Jonny" });
  });

  it("refuses another profile's handle (409 handle_taken)", async () => {
    const [a, b] = [await createProfile(), await createProfile()];
    const res = await SELF.fetch(`${BASE}/me`, {
      method: "PATCH",
      headers: bearer(b.token),
      body: JSON.stringify({ handle: a.profile.handle }),
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("handle_taken");
  });

  it("rejects an invalid edit (400 invalid_body)", async () => {
    const p = await createProfile();
    const res = await SELF.fetch(`${BASE}/me`, {
      method: "PATCH",
      headers: bearer(p.token),
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("profile token errors", () => {
  it("401 missing_auth without a header", async () => {
    const res = await SELF.fetch(`${BASE}/me`);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("missing_auth");
  });

  it("401 invalid_auth for a non-Bearer header", async () => {
    const res = await SELF.fetch(`${BASE}/me`, { headers: { Authorization: "Basic abc" } });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("invalid_auth");
  });

  it("401 invalid_token for a forged, expired or household token", async () => {
    const p = await createProfile();
    const tokens = [
      await signJwt({ ...claimsOf(p.token) }, "wrong-secret"),
      await signJwt({ ...claimsOf(p.token), exp: 1 }, "test-jwt-secret"),
      await signJwt({ hid: "hh", did: "d", kind: "phone", exp: 4_000_000_000 }, "test-jwt-secret"),
      "garbage",
    ];
    for (const token of tokens) {
      const res = await SELF.fetch(`${BASE}/me`, { headers: bearer(token) });
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("invalid_token");
    }
  });

  it("404 profile_not_found for a valid token of a profile that doesn't exist", async () => {
    const token = await signJwt(
      { sub: "nobody", did: "d", kind: "phone", exp: 4_000_000_000 },
      "test-jwt-secret",
    );
    const res = await SELF.fetch(`${BASE}/me`, { headers: bearer(token) });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("profile_not_found");
  });

  it("403 profile_token_required for a launcher token on /me", async () => {
    const p = await createProfile();
    const s = await createSession(p);
    const res = await SELF.fetch(`${BASE}/me`, { headers: bearer(s.token) });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("profile_token_required");
  });
});
