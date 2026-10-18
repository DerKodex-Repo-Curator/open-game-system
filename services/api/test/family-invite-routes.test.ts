import { type Claims, FamilyInviteSchema, InviteStatsSchema } from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";

// Acceptance: 2026-10-18-invite-another-family.feature. The funnel's four wide events, one
// invite_id through all of them: funnel.invite_sent → funnel.link_opened → funnel.testflight_tap →
// funnel.first_session.
const SECRET = "family-invite-secret";
let d1: TestD1;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  await d1.db.batch([
    d1.db.prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES ('dana', 'dana', 'Dana', 'bear')"),
    d1.db.prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES ('lee', 'lee', 'Lee', 'owl')"),
  ]);
});
afterEach(() => vi.restoreAllMocks());

const env = () => ({ DB: d1.db, OGS_JWT_SECRET: SECRET });
const phone = (sub: string) =>
  issueToken({ sub, did: `${sub}-phone`, kind: "phone" } satisfies Omit<Claims, "exp">, SECRET, {
    now: Date.now(),
    ttlSeconds: 600,
  });
const Body = z.record(z.string(), z.unknown());

async function call(method: string, path: string, opts: { auth?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) headers.Authorization = `Bearer ${opts.auth}`;
  const res = await app.request(
    `/api/v1${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    env(),
  );
  const text = await res.text();
  return { status: res.status, body: text ? Body.parse(JSON.parse(text)) : null };
}

/** The funnel's wide events logged so far (console.info lines whose event starts with "funnel."). */
function funnelEvents() {
  const lines = vi.spyOn(console, "info").mockImplementation(() => {});
  return () =>
    lines.mock.calls
      .map(([line]) => Body.safeParse(line))
      .flatMap((r) => (r.success ? [r.data] : []))
      .filter((l) => typeof l.event === "string" && l.event.startsWith("funnel."));
}

async function invite(appId = "rocket-crew") {
  const r = await call("POST", "/family-invites", { auth: await phone("dana"), body: { appId } });
  expect(r.status).toBe(201);
  return FamilyInviteSchema.parse(r.body);
}
const stats = async (id: string) => InviteStatsSchema.parse((await call("GET", `/family-invites/${id}`)).body);

describe("invite another family", () => {
  it("makes a game link with the invite and logs funnel.invite_sent", async () => {
    const events = funnelEvents();
    const inv = await invite();
    expect(inv.link).toBe(`https://opengame.org/play/rocket-crew?inv=${inv.inviteId}`);
    expect(events()).toEqual([
      expect.objectContaining({
        event: "funnel.invite_sent",
        invite_id: inv.inviteId,
        profile_id: "dana",
        app_id: "rocket-crew",
      }),
    ]);
    expect(await stats(inv.inviteId)).toEqual({
      appId: "rocket-crew",
      opened: 0,
      testflightTaps: 0,
      firstSession: false,
    });
  });

  it("only for a game in the catalogue, from a phone", async () => {
    expect((await call("POST", "/family-invites", { auth: await phone("dana"), body: { appId: "nope" } })).status).toBe(400);
    expect((await call("POST", "/family-invites", { body: { appId: "rocket-crew" } })).status).toBe(401);
  });

  it("the page reports link_opened and testflight_tap, counted and logged", async () => {
    const inv = await invite();
    const events = funnelEvents();
    for (const step of ["link_opened", "link_opened", "testflight_tap"])
      expect((await call("POST", `/family-invites/${inv.inviteId}/events`, { body: { step } })).status).toBe(204);
    expect(events().map((e) => [e.event, e.invite_id, e.app_id])).toEqual([
      ["funnel.link_opened", inv.inviteId, "rocket-crew"],
      ["funnel.link_opened", inv.inviteId, "rocket-crew"],
      ["funnel.testflight_tap", inv.inviteId, "rocket-crew"],
    ]);
    expect(await stats(inv.inviteId)).toMatchObject({ opened: 2, testflightTaps: 1 });
  });

  it("refuses a step it doesn't know, or an invite that doesn't exist", async () => {
    const inv = await invite();
    expect((await call("POST", `/family-invites/${inv.inviteId}/events`, { body: { step: "invite_sent" } })).status).toBe(400);
    const missing = "6f0c2a9e-1b7d-4c3e-9a51-2f1d8c7b0e44";
    expect((await call("POST", `/family-invites/${missing}/events`, { body: { step: "link_opened" } })).status).toBe(404);
    expect((await call("GET", `/family-invites/${missing}`)).status).toBe(404);
    expect((await call("GET", "/family-invites/nope")).status).toBe(404);
  });

  it("the invited household's first couch logs funnel.first_session, once", async () => {
    const inv = await invite();
    const events = funnelEvents();
    const lee = await phone("lee");
    const first = await call("POST", "/sessions", { auth: lee, body: { tvName: "Browser TV", invite: inv.inviteId } });
    expect(first.status).toBe(201);
    await call("POST", "/sessions", { auth: lee, body: { tvName: "Browser TV", invite: inv.inviteId } });
    expect(events()).toEqual([
      expect.objectContaining({
        event: "funnel.first_session",
        invite_id: inv.inviteId,
        profile_id: "lee",
        session_id: first.body?.sessionId,
        app_id: "rocket-crew",
      }),
    ]);
    expect(await stats(inv.inviteId)).toMatchObject({ firstSession: true });
  });

  it("a household that has cast before, or the inviter, doesn't count", async () => {
    const inv = await invite();
    const lee = await phone("lee");
    await call("POST", "/sessions", { auth: lee, body: { tvName: "Living room" } });
    const events = funnelEvents();
    await call("POST", "/sessions", { auth: lee, body: { tvName: "Living room", invite: inv.inviteId } });
    const fresh = await call("POST", "/sessions", { auth: await phone("dana"), body: { tvName: "TV", invite: inv.inviteId } });
    expect(fresh.status).toBe(201);
    expect(events()).toEqual([]);
    expect(await stats(inv.inviteId)).toMatchObject({ firstSession: false });
  });

  it("a cast with an unknown or malformed invite still casts", async () => {
    const lee = await phone("lee");
    for (const invite of ["6f0c2a9e-1b7d-4c3e-9a51-2f1d8c7b0e44", "nope"])
      expect((await call("POST", "/sessions", { auth: lee, body: { tvName: "TV", invite } })).status).toBe(201);
  });

  it("names no one: the counts carry no profile", async () => {
    const inv = await invite();
    const text = JSON.stringify((await call("GET", `/family-invites/${inv.inviteId}`)).body);
    for (const who of ["dana", "Dana", "bear"]) expect(text).not.toContain(who);
  });
});
