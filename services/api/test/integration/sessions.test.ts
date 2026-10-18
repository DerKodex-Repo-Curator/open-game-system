import { SELF } from "cloudflare:test";
import { InstanceSchema } from "@open-game-system/ogs-protocol";
import { describe, expect, it } from "vitest";
import {
  BASE,
  bearer,
  claimsOf,
  createProfile,
  createSession,
  ErrorSchema,
  joinSession,
  SessionSchema,
} from "./helpers";

const errorOf = async (res: Response) => ErrorSchema.parse(await res.json()).error.code;

describe("POST /sessions — casting starts a session owned by the caster", () => {
  it("makes a session with the caster as host, a TV code and a 12 h launcher token", async () => {
    const host = await createProfile({ name: "Jonathan", sticker: "bear" });
    const s = await createSession(host, "Living room TV");
    expect(s).toEqual({
      sessionId: expect.any(String),
      code: expect.stringMatching(/^[A-Z2-9]{6}$/),
      tvName: "Living room TV",
      host: host.profile,
      token: expect.any(String),
    });
    const claims = claimsOf(s.token);
    expect(claims).toEqual({
      sub: host.profile.id,
      did: expect.stringMatching(/^launcher-/),
      kind: "launcher",
      sid: s.sessionId,
      exp: expect.any(Number),
    });
    const hours = (claims.exp * 1000 - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
  });

  it("every cast is a new session with its own code", async () => {
    const host = await createProfile();
    const [a, b] = [await createSession(host), await createSession(host)];
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.code).not.toBe(b.code);
  });

  it("needs a TV name (400 invalid_body)", async () => {
    const host = await createProfile();
    const res = await SELF.fetch(`${BASE}/sessions`, {
      method: "POST",
      headers: bearer(host.token),
      body: JSON.stringify({ tvName: "" }),
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("invalid_body");
  });

  it("a launcher can't start a session (403 profile_token_required)", async () => {
    const host = await createProfile();
    const s = await createSession(host);
    const res = await SELF.fetch(`${BASE}/sessions`, {
      method: "POST",
      headers: bearer(s.token),
      body: JSON.stringify({ tvName: "TV" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /sessions/:sid", () => {
  it("tells the launcher its TV name, host and code", async () => {
    const host = await createProfile({ name: "Jonathan" });
    const s = await createSession(host, "Living room TV");
    const res = await SELF.fetch(`${BASE}/sessions/${s.sessionId}`, { headers: bearer(s.token) });
    expect(res.status).toBe(200);
    expect(SessionSchema.parse(await res.json())).toEqual({
      sessionId: s.sessionId,
      code: s.code,
      tvName: "Living room TV",
      host: host.profile,
    });
  });

  it("is open to the host and members, not to others (403 not_a_member)", async () => {
    const host = await createProfile();
    const juneau = await createProfile({ name: "Juneau", kind: "tablet" });
    const stranger = await createProfile({ name: "Stranger" });
    const s = await createSession(host);
    await joinSession(juneau, s.code);
    const get = (token: string) =>
      SELF.fetch(`${BASE}/sessions/${s.sessionId}`, { headers: bearer(token) });
    expect((await get(host.token)).status).toBe(200);
    expect((await get(juneau.token)).status).toBe(200);
    const res = await get(stranger.token);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("not_a_member");
    const other = await createSession(host);
    expect((await get(other.token)).status).toBe(403);
  });

  it("404 session_not_found for an unknown session", async () => {
    const host = await createProfile();
    const res = await SELF.fetch(`${BASE}/sessions/nope`, { headers: bearer(host.token) });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("session_not_found");
  });
});

describe("POST /sessions/join — join with the TV code", () => {
  it("joins with the code (any case, spaces and dashes ignored) and answers the session", async () => {
    const host = await createProfile({ name: "Jonathan" });
    const juneau = await createProfile({ name: "Juneau", kind: "tablet" });
    const s = await createSession(host);
    const typed = `${s.code.slice(0, 3).toLowerCase()}-${s.code.slice(3)} `;
    const res = await joinSession(juneau, typed);
    expect(res.status).toBe(200);
    expect(SessionSchema.parse(await res.json())).toEqual({
      sessionId: s.sessionId,
      code: s.code,
      tvName: s.tvName,
      host: host.profile,
    });
    expect((await joinSession(juneau, s.code)).status).toBe(200);
  });

  it("a code no session has is 404 session_not_found", async () => {
    const p = await createProfile();
    const res = await joinSession(p, "ZZZZZZ");
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("session_not_found");
  });

  it("needs a code (400 invalid_body) and a profile token (401)", async () => {
    const p = await createProfile();
    const res = await SELF.fetch(`${BASE}/sessions/join`, {
      method: "POST",
      headers: bearer(p.token),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const anon = await SELF.fetch(`${BASE}/sessions/join`, {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEF" }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("the launcher reads the host's games", () => {
  it("GET /me/instances with a launcher token lists the host's instances", async () => {
    const host = await createProfile();
    await SELF.fetch(`${BASE}/me/instances`, {
      method: "POST",
      headers: bearer(host.token),
      body: JSON.stringify({
        instanceId: "rc-1",
        appId: "rocket-crew",
        status: "active",
        source: "visit",
      }),
    });
    const s = await createSession(host);
    const res = await SELF.fetch(`${BASE}/me/instances`, { headers: bearer(s.token) });
    expect(res.status).toBe(200);
    const list = InstanceSchema.array().parse(await res.json());
    expect(list.map((i) => [i.instanceId, i.profileId])).toEqual([["rc-1", host.profile.id]]);
  });
});
