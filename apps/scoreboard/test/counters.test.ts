/**
 * Exact counts, on synthetic events: the scoreboard tails the try Workers (every log, unsampled) and
 * writes one Analytics Engine data point per front-page open and per round; /get-app taps and docs
 * downloads land in the same dataset. Read back with SQL, weighted as Analytics Engine reports it.
 */
import { describe, expect, it } from "vitest";
import { datapointsFrom, TAILED } from "../src/tail";
import { readCounters, recentTotals } from "../src/sources/counters";
import { getAppRedirect } from "../src/get-app";
import { parseManual, EMPTY_MANUAL } from "../src/manual";
import type { SqlLike } from "../src/sources/logs";

/** A synthetic tail event, shaped like a TraceItem's fields the tail handler reads. */
const trace = (scriptName: string, url: string | null, logs: unknown[][] = []) => ({
  scriptName,
  event: url ? { request: { url } } : null,
  logs: logs.map((message) => ({ message })),
});

describe("datapointsFrom: tail events → Analytics Engine data points", () => {
  it("counts a front-page open with its ?ref= as a launch", () => {
    expect(datapointsFrom([trace("rocket-crew-try", "https://rocket-crew-try.example/?ref=hn")])).toEqual([
      { indexes: ["rocket-crew-try"], blobs: ["launch", "hn", ""], doubles: [1] },
    ]);
  });
  it("counts the game's round event (with its phase) as a round, with the event's ref", () => {
    const item = trace("rocket-crew-try", null, [
      [{ event: "rocket.round", phase: "launched", ref: "hn", room: "ABCD" }],
      [{ event: "rocket.round", phase: "landed", ref: "hn" }],
      ["a plain log line"],
    ]);
    expect(datapointsFrom([item])).toEqual([{ indexes: ["rocket-crew-try"], blobs: ["round", "hn", "rocket.round"], doubles: [1] }]);
  });
  it("a round with no ref counts as direct; other pages and other Workers count nothing", () => {
    expect(datapointsFrom([trace("night-flight-try", null, [[{ event: "nightflight.round", phase: "dealt" }]])])[0]?.blobs).toEqual(["round", "direct", "nightflight.round"]);
    expect(datapointsFrom([trace("rocket-crew-try", "https://x.example/tv/ABCD?ref=hn"), trace("some-other-worker", "https://y.example/?ref=hn")])).toEqual([]);
  });
  it("tails the four try Workers this board may change (not Bake Shop, Story Nook or Midnight Museum)", () => {
    expect([...TAILED].sort()).toEqual(["night-flight-try", "peekaboo-garden-try", "rocket-crew-try", "trivia-jam-try"]);
  });
});

describe("readCounters: the Analytics Engine dataset, by script, kind and ref", () => {
  it("groups weighted counts", async () => {
    const sql: SqlLike = {
      async query(req) {
        expect(req.query).toContain('events.analyticsEngine."ogs_try_events"');
        return { data: [{ script: "rocket-crew-try", kind: "round", ref: "hn", n: 120 }, { script: "get-app", kind: "get_app", ref: "coop", n: 7 }] };
      },
    };
    const c = await readCounters(sql, new Date("2026-10-21T07:00:00Z"));
    expect(c.get("rocket-crew-try", "round")).toEqual({ hn: 120 });
    expect(c.get("get-app", "get_app")).toEqual({ coop: 7 });
    expect(c.get("bake-shop-try", "round")).toEqual({});
  });
});

describe("/get-app: count the tap, then send people to TestFlight", () => {
  it("writes a data point with the source and redirects to the TestFlight link", () => {
    const points: unknown[] = [];
    const res = getAppRedirect(new URL("https://b.dev/get-app?utm_source=coop&game=bake-shop"), "https://testflight.apple.com/join/ABC", { writeDataPoint: (p) => points.push(p) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://testflight.apple.com/join/ABC");
    expect(points).toEqual([{ indexes: ["get-app"], blobs: ["get_app", "coop", "bake-shop"], doubles: [1] }]);
  });
  it("no public TestFlight link yet: sends people to the front door with their source, still counted", () => {
    const res = getAppRedirect(new URL("https://b.dev/get-app?src=invite"), undefined, { writeDataPoint: () => {} });
    expect(res.headers.get("location")).toBe("https://ogs-front-door.jonathanrmumm.workers.dev/?utm_source=invite");
  });
  it("only a short slug is kept as the source", () => {
    const points: AnalyticsEngineDataPoint[] = [];
    getAppRedirect(new URL("https://b.dev/get-app?utm_source=<script>"), undefined, { writeDataPoint: (p) => void (p && points.push(p)) });
    expect(points[0]?.blobs?.[1]).toBe("direct");
  });
});

describe("manual numbers Jon reads off App Store Connect and the clip apps", () => {
  it("parses the form: TestFlight joins (total, from invites, from the co-op) and views per clip", () => {
    const form = new URLSearchParams({ joins_total: "14", joins_invite: "3", joins_coop: "", "views:trivia-jam-1:tiktok": "5200", "views:bake-shop-2:reels": "abc" });
    expect(parseManual(form, "2026-10-26T17:00:00Z")).toEqual({
      updatedAt: "2026-10-26T17:00:00Z",
      joins: { total: 14, invite: 3, coop: null },
      clipViews: { "trivia-jam-1:tiktok": 5200 },
    });
  });
  it("starts empty", () => {
    expect(EMPTY_MANUAL.joins).toEqual({ total: null, invite: null, coop: null });
  });
});

describe("recentTotals: proof the counters flow (the board's Sources table)", () => {
  it("sums the last 24 hours by script and kind", async () => {
    const sql: SqlLike = { query: async () => ({ data: [{ script: "rocket-crew-try", kind: "launch", ref: "x", n: 3 }, { script: "rocket-crew-try", kind: "launch", ref: "hn", n: 2 }, { script: "get-app", kind: "get_app", ref: "coop", n: 1 }] }) };
    expect(await recentTotals(sql, new Date("2026-10-18T20:00:00Z"))).toBe("rocket-crew-try launch 5, get-app get_app 1 (last 24 h)");
  });
  it("nothing yet: says so", async () => {
    expect(await recentTotals({ query: async () => ({ data: [] }) }, new Date())).toBe("no data points in the last 24 h");
  });
});
