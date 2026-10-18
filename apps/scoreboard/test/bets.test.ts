import { describe, expect, it } from "vitest";
import { BETS, judge, type Inputs, type TryGame } from "../src/bets";
import { EMPTY_MANUAL } from "../src/manual";

/** Synthetic inputs: what the sources would report. Every bet's numbers start at zero. */
function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    funnel: { sessions: 0, sessionsWithInvite: 0, invitesSent: 0, linksOpened: 0, testflightTaps: 0, firstSessions: 0 },
    frontDoor: { since: "2026-10-18T00:00:00Z", bySource: {} },
    tryGames: [],
    waitlist: { signups: 0, bySource: {} },
    hn: { points: null },
    clips: {},
    getApp: {},
    downloads: null,
    manual: EMPTY_MANUAL,
    ...over,
  };
}
const READ = new Date("2026-10-27T18:00:00Z");
const BEFORE = new Date("2026-10-20T18:00:00Z");
const bet = (n: number) => {
  const b = BETS.find((x) => x.n === n);
  if (!b) throw new Error(`no bet ${n}`);
  return b;
};
const check = (v: ReturnType<typeof judge>, id: string) => v.checks.find((c) => c.id === id);
const visits = (view: number, getapp = 0) => ({ view, getapp, try: 0 });

describe("the five bets, from docs/research/next-week-bets.md", () => {
  it("are numbered 1-5, each read at the end of its read day (PT)", () => {
    expect(BETS.map((b) => b.n)).toEqual([1, 2, 3, 4, 5]);
    expect(bet(3).read.toISOString()).toBe("2026-10-24T06:59:59.000Z"); // Fri 10-23
    expect(bet(1).read.toISOString()).toBe("2026-10-27T06:59:59.000Z"); // Mon 10-26
  });
  it("count from the start of their week, Mon 10-19 PT (bet 3 from the post, Wed 10-21)", () => {
    expect(bet(1).from.toISOString()).toBe("2026-10-19T07:00:00.000Z");
    expect(bet(3).from.toISOString()).toBe("2026-10-21T07:00:00.000Z");
  });
});

describe("bet 1: push-link invites bring in a second household", () => {
  const funnel = (sessions: number, sessionsWithInvite: number, firstSessions: number) => ({
    sessions,
    sessionsWithInvite,
    invitesSent: sessionsWithInvite,
    linksOpened: sessionsWithInvite,
    testflightTaps: sessionsWithInvite,
    firstSessions,
  });
  it("passes with 30% of sessions inviting and 3 invited households playing", () => {
    expect(judge(bet(1), inputs({ funnel: funnel(10, 3, 3) }), READ).status).toBe("pass");
  });
  it("fails under 10% of sessions inviting", () => {
    expect(judge(bet(1), inputs({ funnel: funnel(20, 1, 1) }), READ).status).toBe("fail");
  });
  it("fails when no invited household installs, however many invites", () => {
    expect(judge(bet(1), inputs({ funnel: funnel(10, 5, 0) }), READ).status).toBe("fail");
  });
  it("in between: neither pass nor fail", () => {
    expect(judge(bet(1), inputs({ funnel: funnel(10, 2, 1) }), READ).status).toBe("between");
  });
  it("before its read date it is running, with the numbers so far", () => {
    const v = judge(bet(1), inputs({ funnel: funnel(10, 3, 3) }), BEFORE);
    expect(v.status).toBe("running");
    expect(check(v, "invite-rate")?.value).toBeCloseTo(0.3);
  });
  it("no hosted sessions yet: the rate can't be read", () => {
    const v = judge(bet(1), inputs(), READ);
    expect(check(v, "invite-rate")?.value).toBeNull();
    expect(v.status).toBe("missing");
  });
});

describe("bet 2: short clips find a hook", () => {
  it("counts catalogue visits from short-form tags (tiktok, reels, shorts)", () => {
    const bySource = { tiktok: visits(30, 1), reels: visits(8), shorts: visits(4), hn: visits(900) };
    expect(check(judge(bet(2), inputs({ frontDoor: { since: "x", bySource } }), READ), "shortform-visits")?.value).toBe(42);
  });
  it("clip views can't be measured: the bet says so instead of passing", () => {
    const v = judge(bet(2), inputs({ frontDoor: { since: "x", bySource: { tiktok: visits(50) } } }), READ);
    expect(check(v, "clip-views")?.source).toBe("missing");
    expect(v.status).toBe("missing");
  });
});

describe("bet 3: Show HN", () => {
  const games: TryGame[] = [
    { game: "Rocket Crew", script: "rocket-crew-try", launches: { hn: 300 }, rounds: { hn: 60, load: 900 }, sampled: true },
    { game: "Trivia Jam", script: "trivia-jam-try", launches: { hn: 200 }, rounds: null, sampled: true },
    { game: "Bake Shop", script: "bake-shop-try", launches: { hn: 100 }, rounds: { hn: 50 }, sampled: true },
  ];
  it("passes with 50 points, 1,000 catalogue visits and 100 rounds from hn", () => {
    const v = judge(bet(3), inputs({ hn: { points: 120 }, frontDoor: { since: "x", bySource: { hn: visits(1200, 10) } }, tryGames: games }), READ);
    expect(check(v, "hn-rounds")?.value).toBe(110);
    expect(v.status).toBe("pass");
  });
  it("only ?ref=hn counts: test traffic (load, seam...) never does", () => {
    const tryGames = [{ game: "Rocket Crew", script: "rocket-crew-try", launches: { load: 3000 }, rounds: { load: 3000 }, sampled: true }];
    expect(check(judge(bet(3), inputs({ tryGames }), BEFORE), "hn-rounds")?.value).toBe(0);
  });
  it("fails under 10 points", () => {
    expect(judge(bet(3), inputs({ hn: { points: 6 } }), READ).status).toBe("fail");
  });
  it("rounds from the logs are an estimate (Workers Logs samples 1 in 10)", () => {
    expect(check(judge(bet(3), inputs({ tryGames: games }), READ), "hn-rounds")?.source).toBe("estimate");
  });
  it("no post yet (no HN item id): points are missing, not zero", () => {
    expect(check(judge(bet(3), inputs(), BEFORE), "hn-points")?.value).toBeNull();
  });
});

describe("bet 4: your web game on a real TV", () => {
  it("passes with 20 waitlist signups", () => {
    expect(judge(bet(4), inputs({ waitlist: { signups: 20, bySource: {} } }), READ).status).toBe("pass");
  });
  it("fails under 5 signups", () => {
    expect(judge(bet(4), inputs({ waitlist: { signups: 4, bySource: {} } }), READ).status).toBe("fail");
  });
  it("in between, the outside developers who got a game casting can't be counted yet", () => {
    const v = judge(bet(4), inputs({ waitlist: { signups: 9, bySource: {} } }), READ);
    expect(check(v, "outside-devs")?.source).toBe("missing");
    expect(v.status).toBe("missing");
  });
});

describe("bet 5: a homeschool co-op game day", () => {
  it("TestFlight joins are missing; co-op TestFlight taps are shown as the nearest proxy", () => {
    const v = judge(bet(5), inputs({ frontDoor: { since: "x", bySource: { coop: visits(30, 9) } } }), READ);
    expect(check(v, "coop-joins")?.source).toBe("missing");
    expect(check(v, "coop-taps")?.value).toBe(9);
    expect(v.status).toBe("missing");
  });
});

describe("the gaps closed: manual numbers, exact counters, clip landings, downloads", () => {
  const manual = (over: Partial<Inputs["manual"]>) => ({ ...EMPTY_MANUAL, updatedAt: "2026-10-26T17:00:00Z", ...over });
  it("bet 1 reads invited households' TestFlight joins from App Store Connect when Jon has typed them", () => {
    const funnel = { sessions: 10, sessionsWithInvite: 4, invitesSent: 5, linksOpened: 5, testflightTaps: 4, firstSessions: 1 };
    const v = judge(bet(1), inputs({ funnel, manual: manual({ joins: { total: 9, invite: 3, coop: null } }) }), READ);
    expect(check(v, "invite-joins")).toMatchObject({ value: 3, source: "manual" });
    expect(v.status).toBe("pass");
  });
  it("bet 2: the best clip's views (typed in) and each clip's landings (front door campaigns)", () => {
    const clips = { "trivia-jam-1": { tiktok: 30, reels: 2, shorts: 0 }, "bake-shop-2": { tiktok: 12, reels: 0, shorts: 1 } };
    const v = judge(bet(2), inputs({ clips, manual: manual({ clipViews: { "trivia-jam-1:tiktok": 6200, "bake-shop-2:reels": 800 } }) }), READ);
    expect(check(v, "clip-views")).toMatchObject({ value: 6200, source: "manual" });
    expect(check(v, "clip-landings")).toMatchObject({ value: 32 });
  });
  it("bet 2 passes on 5,000 views and 40 short-form visits; fails when every clip stays under 1,000", () => {
    const bySource = { tiktok: visits(45) };
    expect(judge(bet(2), inputs({ frontDoor: { since: "x", bySource }, manual: manual({ clipViews: { "a:tiktok": 5000 } }) }), READ).status).toBe("pass");
    expect(judge(bet(2), inputs({ manual: manual({ clipViews: { "a:tiktok": 900, "b:reels": 300 } }) }), READ).status).toBe("fail");
  });
  it("bet 3: tailed games count exactly; the board says which games are still estimates", () => {
    const tryGames: TryGame[] = [
      { game: "Rocket Crew", script: "rocket-crew-try", launches: { hn: 300 }, rounds: { hn: 70 }, sampled: false },
      { game: "Bake Shop", script: "bake-shop-try", launches: { hn: 100 }, rounds: { hn: 30 }, sampled: true },
    ];
    const c = check(judge(bet(3), inputs({ tryGames }), READ), "hn-rounds");
    expect(c?.value).toBe(100);
    expect(c?.source).toBe("estimate");
    expect(c?.note).toContain("Bake Shop");
    const exact = check(judge(bet(3), inputs({ tryGames: tryGames.slice(0, 1) }), READ), "hn-rounds");
    expect(exact?.source).toBe("exact");
  });
  it("bet 4 shows starter downloads once the docs count them; missing until then", () => {
    expect(check(judge(bet(4), inputs({ downloads: null }), READ), "downloads")?.source).toBe("missing");
    expect(check(judge(bet(4), inputs({ downloads: { "/starter.tgz": 14, "/pkg/profile-kit.tgz": 9 } }), READ), "downloads")).toMatchObject({ value: 14, source: "exact" });
  });
  it("bet 5 reads co-op TestFlight joins typed in from App Store Connect, and counts /get-app taps from the handout", () => {
    const v = judge(bet(5), inputs({ getApp: { coop: 11 }, frontDoor: { since: "x", bySource: { coop: visits(20, 4) } }, manual: manual({ joins: { total: 12, invite: null, coop: 9 } }) }), READ);
    expect(check(v, "coop-joins")).toMatchObject({ value: 9, source: "manual" });
    expect(check(v, "coop-taps")?.value).toBe(15);
    expect(v.status).toBe("pass");
  });
});
