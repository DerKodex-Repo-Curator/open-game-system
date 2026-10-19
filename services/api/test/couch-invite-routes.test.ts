import {
  type Claims,
  CouchInviteResultSchema,
  RecentPlayersSchema,
} from "@open-game-system/ogs-protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";

// The second visit (docs/acceptance/2026-10-18-second-visit.feature, "Invite last week's players"):
// while Dana's couch is on, she can push a join link to the people who shared a couch with her in
// the last 7 days. Never to anyone else, never to a tablet (a kid's), once per person per couch.
const SECRET = "couch-invite-secret";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let d1: TestD1;
let expoCalls: { to: string; title: string; body: string; data?: Record<string, string> }[];

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const now = Date.now();
  const people = [
    ["dana", "Dana", "bear"],
    ["lee", "Lee", "owl"],
    ["sam", "Sam", "whale"],
    ["june", "June", "dragon"],
    ["grandma", "Grandma", "turtle"],
    ["stranger", "Stranger", "mouse"],
    ["old", "Old Friend", "cloud"],
  ];
  await d1.db.batch([
    ...people.map(([id, name, sticker]) =>
      d1.db
        .prepare("INSERT INTO profiles (id, handle, name, sticker) VALUES (?, ?, ?, ?)")
        .bind(id, id, name, sticker),
    ),
    // Phones (reachable) and June's iPad (a kid's: never pushed).
    ...["lee", "sam", "stranger", "old", "dana"].flatMap((id) => [
      d1.db
        .prepare(
          "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES (?, ?, 'phone', 'Phone')",
        )
        .bind(`${id}-phone`, id),
      d1.db
        .prepare("INSERT INTO devices (ogs_device_id, platform, push_token) VALUES (?, 'ios', ?)")
        .bind(`${id}-phone`, `ExponentPushToken[${id}]`),
    ]),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('june-ipad', 'june', 'tablet', 'iPad')",
    ),
    d1.db.prepare(
      "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('june-ipad', 'ios', 'ExponentPushToken[june]')",
    ),
    // Last week: Dana hosted Lee, June and the browser guest Grandma; Sam hosted Dana.
    d1.db
      .prepare(
        "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('s-week', 'dana', 'WEEK01', 'TV', ?)",
      )
      .bind(now - 3 * DAY),
    d1.db
      .prepare(
        "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('s-sam', 'sam', 'SAMS01', 'TV', ?)",
      )
      .bind(now - 5 * DAY),
    // A month ago with an old friend: too long ago.
    d1.db
      .prepare(
        "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('s-old', 'dana', 'OLD001', 'TV', ?)",
      )
      .bind(now - 30 * DAY),
    ...[
      ["s-week", "dana"],
      ["s-week", "lee"],
      ["s-week", "june"],
      ["s-week", "grandma"],
      ["s-sam", "sam"],
      ["s-sam", "dana"],
      ["s-old", "dana"],
      ["s-old", "old"],
    ].map(([sid, pid]) =>
      d1.db
        .prepare("INSERT INTO session_members (session_id, profile_id, joined_at) VALUES (?, ?, ?)")
        .bind(sid, pid, now - 3 * DAY),
    ),
    d1.db
      .prepare(
        "INSERT INTO guest_profiles (profile_id, session_id, created_at) VALUES ('grandma', 's-week', ?)",
      )
      .bind(now - 3 * DAY),
  ]);
  expoCalls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://exp.host/")) throw new Error(`unexpected fetch ${url}`);
    const sent = JSON.parse(String(init.body));
    for (const m of Array.isArray(sent) ? sent : [sent]) expoCalls.push(m);
    return Response.json({ data: [{ status: "ok", id: "ticket" }] });
  });
});
afterEach(() => vi.unstubAllGlobals());

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

/** Dana's couch tonight (a cast an hour ago). */
async function danaCastsTonight() {
  await d1.db
    .prepare(
      "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('s-now', 'dana', 'NOWNOW', 'Browser TV', ?)",
    )
    .bind(Date.now() - HOUR)
    .run();
}

const recent = async (who = "dana") => {
  const r = await call("GET", "/couch/recent-players", { auth: await phone(who) });
  expect(r.status).toBe(200);
  return RecentPlayersSchema.parse(r.body).players;
};

describe("last week's players", () => {
  it("lists who shared a couch with me in the last 7 days, hosted or joined: newest couch, then name", async () => {
    const players = await recent();
    expect(players.map((p) => p.profileId)).toEqual(["june", "lee", "sam"]);
    expect(players[1]).toEqual({ profileId: "lee", name: "Lee", sticker: "owl", reachable: true });
  });

  it("leaves out me, browser guests (no phone to reach) and couches over a week old", async () => {
    const ids = (await recent()).map((p) => p.profileId);
    expect(ids).not.toContain("dana");
    expect(ids).not.toContain("grandma");
    expect(ids).not.toContain("old");
    expect(ids).not.toContain("stranger");
  });

  it("marks who can't get a notification: only a tablet (a kid's) is never reachable", async () => {
    const june = (await recent()).find((p) => p.profileId === "june");
    expect(june?.reachable).toBe(false);
  });

  it("needs a phone's token", async () => {
    expect((await call("GET", "/couch/recent-players")).status).toBe(401);
  });
});

describe("inviting them to tonight's couch", () => {
  it("pushes the couch's join link to each one's phone", async () => {
    await danaCastsTonight();
    const r = await call("POST", "/couch/invite", {
      auth: await phone("dana"),
      body: { profileIds: ["lee", "sam"] },
    });
    expect(r.status).toBe(200);
    expect(CouchInviteResultSchema.parse(r.body)).toEqual({ invited: ["lee", "sam"], skipped: [] });
    expect(expoCalls.map((c) => c.to).sort()).toEqual([
      "ExponentPushToken[lee]",
      "ExponentPushToken[sam]",
    ]);
    expect(expoCalls[0]).toMatchObject({
      title: "Dana's couch is on",
      body: "Tap to join Dana on the TV.",
      data: { type: "couch-invite", url: "https://opengame.org/join/NOWNOW" },
    });
  });

  it("never reaches anyone else: a stranger, an old friend, a guest, a kid's tablet", async () => {
    await danaCastsTonight();
    const r = await call("POST", "/couch/invite", {
      auth: await phone("dana"),
      body: { profileIds: ["stranger", "old", "grandma", "june", "dana"] },
    });
    expect(CouchInviteResultSchema.parse(r.body)).toEqual({
      invited: [],
      skipped: ["stranger", "old", "grandma", "june", "dana"],
    });
    expect(expoCalls).toEqual([]);
  });

  it("invites each person once per couch", async () => {
    await danaCastsTonight();
    const dana = await phone("dana");
    await call("POST", "/couch/invite", { auth: dana, body: { profileIds: ["lee"] } });
    const again = await call("POST", "/couch/invite", {
      auth: dana,
      body: { profileIds: ["lee"] },
    });
    expect(CouchInviteResultSchema.parse(again.body)).toEqual({ invited: [], skipped: ["lee"] });
    expect(expoCalls).toHaveLength(1);
  });

  it("only while my couch is on (a cast of mine in the last 12 h)", async () => {
    const r = await call("POST", "/couch/invite", {
      auth: await phone("dana"),
      body: { profileIds: ["lee"] },
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: { code: "not_casting" } });
    expect(expoCalls).toEqual([]);
  });

  it("refuses a body that isn't a short list of ids", async () => {
    await danaCastsTonight();
    const dana = await phone("dana");
    for (const body of [
      {},
      { profileIds: [] },
      { profileIds: Array(21).fill("lee") },
      { profileIds: "lee" },
    ])
      expect((await call("POST", "/couch/invite", { auth: dana, body })).status).toBe(400);
  });
});
