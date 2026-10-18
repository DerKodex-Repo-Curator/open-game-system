import { describe, expect, it } from "vitest";
import { readFunnel } from "../src/sources/funnel";
import { readWaitlist } from "../src/sources/waitlist";
import { readTryGames, TRY_GAMES, type SqlLike } from "../src/sources/logs";
import { readHn } from "../src/sources/hn";
import { frontDoorSince, TallySummarySchema, type Snapshot } from "../src/sources/frontdoor";
import { sqliteD1 } from "./sqlite-d1";

const H = 3600_000;
const FROM = Date.parse("2026-10-19T07:00:00Z");
const TO = Date.parse("2026-10-27T06:59:59Z");

/** The opengame-api tables the funnel reads (services/api/schema.sql, trimmed to the columns used). */
const API_SCHEMA = `
CREATE TABLE couch_sessions (id TEXT PRIMARY KEY, host_profile_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, tv_name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE family_invites (id TEXT PRIMARY KEY, from_profile_id TEXT NOT NULL, app_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  opened INTEGER NOT NULL DEFAULT 0, testflight_taps INTEGER NOT NULL DEFAULT 0, first_session_id TEXT, first_session_profile_id TEXT, first_session_at INTEGER);`;

describe("funnel (opengame-api D1): sessions, invites and how far each invited household got", () => {
  it("counts hosted sessions, sessions whose host invited during them, and each funnel step", async () => {
    const { db, exec } = sqliteD1(API_SCHEMA);
    const session = (id: string, host: string, at: number) => exec("INSERT INTO couch_sessions VALUES (?, ?, ?, 'TV', ?)", id, host, id, at);
    const invite = (id: string, from: string, at: number, opened: number, taps: number, firstAt: number | null) =>
      exec("INSERT INTO family_invites VALUES (?, ?, 'rocket-crew', ?, ?, ?, ?, NULL, ?)", id, from, at, opened, taps, firstAt ? `s-${id}` : null, firstAt);
    session("s1", "ada", FROM + 1 * H);
    session("s2", "ada", FROM + 30 * H);
    session("s3", "sam", FROM + 2 * H);
    session("s4", "linus", FROM + 5 * H);
    session("old", "grace", FROM - 48 * H); // before the window
    invite("i1", "ada", FROM + 2 * H, 1, 1, FROM + 10 * H); // during s1: opened, tapped, played
    invite("i2", "sam", FROM + 3 * H, 1, 0, null); // during s3: opened only
    invite("i3", "linus", FROM + 40 * H, 0, 0, null); // 35 h after s4: not during it
    const f = await readFunnel(db, FROM, TO);
    expect(f).toEqual({ sessions: 4, sessionsWithInvite: 2, invitesSent: 3, linksOpened: 2, testflightTaps: 1, firstSessions: 1 });
  });
});

describe("waitlist (ogs-docs D1): signups in the window, by utm_source", () => {
  it("counts signups since the window opened", async () => {
    const { db, exec } = sqliteD1(
      "CREATE TABLE waitlist (email TEXT PRIMARY KEY, building TEXT NOT NULL DEFAULT '', engine TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, referrer TEXT, created_at TEXT NOT NULL);",
    );
    const add = (email: string, source: string | null, at: string) => exec("INSERT INTO waitlist (email, utm_source, created_at) VALUES (?, ?, ?)", email, source, at);
    add("a@example.com", "hn", "2026-10-20T10:00:00.000Z");
    add("b@example.com", "x", "2026-10-21T10:00:00.000Z");
    add("c@example.com", null, "2026-10-21T11:00:00.000Z");
    add("old@example.com", "hn", "2026-10-10T10:00:00.000Z");
    expect(await readWaitlist(db, FROM)).toEqual({ signups: 3, bySource: { hn: 1, x: 1, direct: 1 } });
  });
});

describe("try games (Workers Logs through the Analytics SQL binding)", () => {
  /** A stand-in for the binding: answers each query from synthetic rows, as Workers Logs would. */
  function fakeSql(rows: Record<string, Record<string, unknown>[]>): SqlLike & { asked: { query: string; params: Record<string, unknown> }[] } {
    const asked: { query: string; params: Record<string, unknown> }[] = [];
    return {
      asked,
      async query(req) {
        asked.push({ query: req.query, params: req.params ?? {} });
        const script = String(req.params?.script);
        const kind = req.query.includes("$workers.event.path") ? "launches" : "rounds";
        return { data: rows[`${script}:${kind}`] ?? [] };
      },
    };
  }

  it("knows the seven try Workers and each one's round event", () => {
    expect(TRY_GAMES.map((g) => g.script).sort()).toEqual(
      ["bake-shop-try", "midnight-museum-try", "night-flight-try", "peekaboo-garden-try", "rocket-crew-try", "story-nook-try", "trivia-jam-try"].sort(),
    );
    expect(TRY_GAMES.find((g) => g.script === "rocket-crew-try")?.round).toEqual({ event: "rocket.round", phase: "launched" });
  });

  it("reads link opens and rounds by ?ref=, weighted counts as Workers Logs reports them", async () => {
    const sql = fakeSql({
      "rocket-crew-try:launches": [{ ref: "hn", n: 40 }, { ref: "load", n: 3300 }, { ref: null, n: 10 }],
      "rocket-crew-try:rounds": [{ ref: "hn", n: 20 }],
    });
    const games = await readTryGames(sql, new Date(FROM));
    const rocket = games.find((g) => g.script === "rocket-crew-try");
    expect(rocket).toMatchObject({ launches: { hn: 40, load: 3300, direct: 10 }, rounds: { hn: 20 }, sampled: true });
    const launchQuery = sql.asked.find((a) => a.params.script === "rocket-crew-try" && a.query.includes("$workers.event.path"));
    expect(launchQuery?.params.start).toBe("2026-10-19T07:00:00.000Z");
  });

  it("a game whose round event has no ref reports rounds as unknown, not zero", async () => {
    const games = await readTryGames(fakeSql({}), new Date(FROM));
    expect(games.find((g) => g.script === "trivia-jam-try")?.rounds).toBeNull();
  });

  it("a failed query leaves that game at zero instead of breaking the board", async () => {
    const broken: SqlLike = { query: async () => Promise.reject(new Error("quota")) };
    const games = await readTryGames(broken, new Date(FROM));
    expect(games).toHaveLength(TRY_GAMES.length);
    expect(games[0]?.launches).toEqual({});
  });
});

describe("Hacker News points", () => {
  it("reads the post's score", async () => {
    const fetcher = async (url: string) => new Response(JSON.stringify({ id: 1, score: 87, type: "story" }), { status: url.includes("/item/123.json") ? 200 : 404 });
    expect(await readHn("123", fetcher)).toEqual({ points: 87 });
  });
  it("no item id yet: null", async () => {
    expect(await readHn(undefined, async () => new Response("{}"))).toEqual({ points: null });
  });
});

describe("front door: counts in the window from snapshots of the tally's running totals", () => {
  const snap = (at: string, hn: number, coop = 0): Snapshot => ({ at, bySource: { hn: { view: hn, getapp: 0, try: 0 }, coop: { view: coop, getapp: coop, try: 0 } } });
  it("subtracts the last snapshot at or before the window's start", () => {
    const counts = frontDoorSince([snap("2026-10-18T20:00:00Z", 100), snap("2026-10-19T06:45:00Z", 120, 2), snap("2026-10-22T10:00:00Z", 1300, 9)], new Date(FROM));
    expect(counts).toEqual({ since: "2026-10-19T06:45:00Z", bySource: { hn: { view: 1180, getapp: 0, try: 0 }, coop: { view: 7, getapp: 7, try: 0 } } });
  });
  it("no snapshot before the window: counts from the first one, and says so", () => {
    expect(frontDoorSince([snap("2026-10-20T00:00:00Z", 5), snap("2026-10-21T00:00:00Z", 9)], new Date(FROM)).since).toBe("2026-10-20T00:00:00Z");
  });
  it("a source that first appears inside the window counts in full", () => {
    const counts = frontDoorSince([snap("2026-10-18T00:00:00Z", 1), { at: "2026-10-22T00:00:00Z", bySource: { tiktok: { view: 12, getapp: 1, try: 0 } } }], new Date(FROM));
    expect(counts.bySource.tiktok).toEqual({ view: 12, getapp: 1, try: 0 });
  });
  it("parses the tally's summary at the boundary (its sources rows)", () => {
    const parsed = TallySummarySchema.parse({ views: 3, games: [], campaigns: [], sources: [{ source: "hn", view: 3, getapp: 1, try: 2, play: 0, impression: 0, clip: 0, qr: 0, share: 0, open: 0 }] });
    expect(parsed.sources[0]).toMatchObject({ source: "hn", view: 3, getapp: 1, try: 2 });
  });
});
