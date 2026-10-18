/**
 * The whole board on synthetic events: every source seeded (API and waitlist tables in SQLite, Workers
 * Logs and the front door's tally as stand-ins), gathered per bet window, judged and rendered.
 */
import { describe, expect, it } from "vitest";
import { addSnapshot, gather, MAX_SNAPSHOTS, type Sources } from "../src/board";
import { render } from "../src/render";
import { BETS } from "../src/bets";
import type { Snapshot } from "../src/sources/frontdoor";
import type { SqlLike } from "../src/sources/logs";
import { sqliteD1 } from "./sqlite-d1";

const H = 3600_000;
const MON = Date.parse("2026-10-19T07:00:00Z");
const WED = Date.parse("2026-10-21T07:00:00Z");

function synthetic(): Sources {
  const api = sqliteD1(`
    CREATE TABLE couch_sessions (id TEXT PRIMARY KEY, host_profile_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, tv_name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE family_invites (id TEXT PRIMARY KEY, from_profile_id TEXT NOT NULL, app_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      opened INTEGER NOT NULL DEFAULT 0, testflight_taps INTEGER NOT NULL DEFAULT 0, first_session_id TEXT, first_session_profile_id TEXT, first_session_at INTEGER);`);
  for (let i = 0; i < 10; i++) api.exec("INSERT INTO couch_sessions VALUES (?, ?, ?, 'TV', ?)", `s${i}`, `host${i}`, `C${i}`, MON + i * H);
  for (let i = 0; i < 4; i++) api.exec("INSERT INTO family_invites VALUES (?, ?, 'bake-shop', ?, 1, 1, ?, NULL, ?)", `i${i}`, `host${i}`, MON + i * H + 600_000, `n${i}`, MON + 30 * H);
  const docs = sqliteD1("CREATE TABLE waitlist (email TEXT PRIMARY KEY, utm_source TEXT, created_at TEXT NOT NULL);");
  for (let i = 0; i < 7; i++) docs.exec("INSERT INTO waitlist VALUES (?, 'hn', ?)", `dev${i}@example.com`, new Date(MON + i * H).toISOString());
  const sql: SqlLike = {
    async query(req) {
      const launch = req.query.includes("$workers.event.path");
      if (req.params?.script !== "rocket-crew-try") return { data: [] };
      return { data: launch ? [{ ref: "hn", n: 400 }, { ref: "load", n: 9000 }] : [{ ref: "hn", n: 130 }] };
    },
  };
  return {
    api: api.db,
    waitlist: docs.db,
    sql,
    hn: async () => ({ points: 64 }),
  };
}

const snaps: Snapshot[] = [
  { at: new Date(MON - H).toISOString(), bySource: { hn: { view: 50, getapp: 0, try: 0 }, coop: { view: 0, getapp: 0, try: 0 } } },
  { at: new Date(WED - H).toISOString(), bySource: { hn: { view: 60, getapp: 0, try: 0 }, tiktok: { view: 10, getapp: 0, try: 0 } } },
  { at: new Date(WED + 30 * H).toISOString(), bySource: { hn: { view: 1460, getapp: 40, try: 300 }, tiktok: { view: 55, getapp: 2, try: 0 }, coop: { view: 20, getapp: 6, try: 0 } } },
];

describe("gather: each bet's numbers for its own window", () => {
  it("bet 3 counts from Wed 10-21, the others from Mon 10-19", async () => {
    const windows = await gather(synthetic(), snaps, new Date(WED + 31 * H));
    const mon = windows[new Date(MON).toISOString()];
    const wed = windows[new Date(WED).toISOString()];
    expect(mon?.frontDoor.bySource.hn?.view).toBe(1410);
    expect(wed?.frontDoor.bySource.hn?.view).toBe(1400);
    expect(mon?.funnel).toMatchObject({ sessions: 10, sessionsWithInvite: 4, firstSessions: 4 });
    expect(mon?.waitlist.signups).toBe(7);
    expect(wed?.hn.points).toBe(64);
  });
});

describe("source health: a source that fails is reported, never fatal", () => {
  it("a broken source falls back to empty numbers and says why; the rest still count", async () => {
    const sources = synthetic();
    const broken: Sources = { ...sources, waitlist: { prepare: () => { throw new Error("D1_ERROR: no such table: waitlist"); } } };
    const health: Record<string, string> = {};
    const windows = await gather(broken, snaps, new Date(WED + 31 * H), health);
    expect(windows[new Date(MON).toISOString()]?.waitlist).toEqual({ signups: 0, bySource: {} });
    expect(windows[new Date(MON).toISOString()]?.funnel.sessions).toBe(10);
    expect(health.waitlist).toContain("no such table");
    expect(health.api).toBe("ok");
    expect(health.logs).toBe("ok");
  });
  it("the page lists each source's health", () => {
    const html = render({}, new Date("2026-10-20T00:00:00Z"), "now", { api: "ok", waitlist: "Error: D1_ERROR", tally: "ok: 12 snapshots" });
    expect(html).toContain("Sources");
    expect(html).toContain("D1_ERROR");
    expect(html).toContain("12 snapshots");
  });
});

describe("render: the scoreboard page", () => {
  it("shows each bet against its lines, marks estimates, and lists what can't be measured yet", async () => {
    const now = new Date("2026-10-27T18:00:00Z");
    const windows = await gather(synthetic(), snaps, now);
    const html = render(windows, now, now.toISOString());
    for (const b of BETS) expect(html).toContain(b.title);
    expect(html).toContain("Pass"); // bet 3: 64 points, 1,400 hn visits, 130 rounds
    expect(html).toContain("≈ 130"); // an estimate is marked
    expect(html).toContain("40%"); // bet 1: 4 of 10 sessions invited
    expect(html).toMatch(/Can.t measure yet/);
    expect(html).toContain("TikTok, Reels and Shorts views");
    expect(html).toContain("App Store Connect");
  });
  it("escapes what it prints", () => {
    const html = render({}, new Date("2026-10-20T00:00:00Z"), "<script>");
    expect(html).not.toContain("<script>");
  });
});

describe("snapshots of the front door's totals", () => {
  it("are kept in time order and capped", () => {
    let list: Snapshot[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) list = addSnapshot(list, { at: new Date(MON + i * 900_000).toISOString(), bySource: {} });
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(list[0]?.at).toBe(new Date(MON + 5 * 900_000).toISOString());
  });
});
