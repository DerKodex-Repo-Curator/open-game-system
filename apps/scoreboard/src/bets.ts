/**
 * The five distribution bets (docs/research/next-week-bets.md) and their pass and fail lines. Each
 * bet reads its numbers from `Inputs` (what the sources reported) and says where it stands.
 */

import type { Manual } from "./manual";

/** Visits and taps for one source (utm_source / ref) on the front door. */
export type SourceCounts = { view: number; getapp: number; try: number };

export type TryGame = {
  game: string;
  script: string;
  /** Front-page opens by ?ref= (Workers Logs). */
  launches: Record<string, number>;
  /** Rounds started by ?ref=, or null when the game's round event carries no ref. */
  rounds: Record<string, number> | null;
  /** Workers Logs keeps a sample (1 in 10): counts are estimates. */
  sampled: boolean;
};

export type Inputs = {
  funnel: {
    /** Couch sessions hosted in the window. */
    sessions: number;
    /** Of those, sessions whose host sent at least one invite during the session. */
    sessionsWithInvite: number;
    invitesSent: number;
    linksOpened: number;
    testflightTaps: number;
    /** Invited households whose first couch session happened (funnel.first_session). */
    firstSessions: number;
  };
  /** Counts since `since` (the first snapshot at or before the window's start). */
  frontDoor: { since: string; bySource: Record<string, SourceCounts> };
  tryGames: TryGame[];
  waitlist: { signups: number; bySource: Record<string, number> };
  /** The Show HN post's points, or null before there is a post to read. */
  hn: { points: number | null };
  /** Front-door landings per clip (utm_campaign = the clip id) and platform. */
  clips: Record<string, Record<string, number>>;
  /** /get-app taps by source (counted server-side before the TestFlight redirect). */
  getApp: Record<string, number>;
  /** Docs downloads by path (/starter.tgz, /pkg/*.tgz), or null while the docs don't count them. */
  downloads: Record<string, number> | null;
  /** What Jon typed in from App Store Connect and the clip apps. */
  manual: Manual;
};

/** Where a number comes from: counted exactly, estimated from a sample, or not measurable yet. */
export type Source = "exact" | "estimate" | "manual" | "missing";

export type Check = {
  id: string;
  label: string;
  value: number | null;
  /** e.g. "≥ 30%", "≥ 1,000". */
  target: string;
  source: Source;
  /** What feeds it, or (for a missing one) what it would take. */
  note: string;
  format?: "percent" | "count";
};

export type Status = "running" | "pass" | "fail" | "between" | "missing";
export type Verdict = { status: Status; checks: Check[] };

/** Three-valued: true, false, or not known yet. */
type Tri = boolean | null;
const at = (v: number | null, ok: (n: number) => boolean): Tri => (v === null ? null : ok(v));
const and = (...xs: Tri[]): Tri => (xs.some((x) => x === false) ? false : xs.some((x) => x === null) ? null : true);
const or = (...xs: Tri[]): Tri => (xs.some((x) => x === true) ? true : xs.some((x) => x === null) ? null : false);

export type Bet = {
  n: number;
  title: string;
  pass: string;
  fail: string;
  from: Date;
  read: Date;
  checks: (i: Inputs) => Check[];
  /** Pass and fail, from the checks' values by id. */
  decide: (v: (id: string) => number | null) => { pass: Tri; fail: Tri };
};

/** Midnight at the start of a PT (PDT, UTC-7) day, and the last second of one. */
const startPT = (day: string) => new Date(`${day}T00:00:00-07:00`);
const endPT = (day: string) => new Date(`${day}T23:59:59-07:00`);

const SHORT_FORM = ["tiktok", "reels", "shorts"];
const views = (i: Inputs, sources: string[]) => sources.reduce((n, s) => n + (i.frontDoor.bySource[s]?.view ?? 0), 0);
const sumRef = (counts: (g: TryGame) => Record<string, number> | null, i: Inputs, ref: string) =>
  i.tryGames.reduce((n, g) => n + (counts(g)?.[ref] ?? 0), 0);
const anySampled = (i: Inputs) => i.tryGames.some((g) => g.sampled);
const sampledNames = (i: Inputs) => i.tryGames.filter((g) => g.sampled).map((g) => g.game);
const sumValues = (r: Record<string, number>) => Object.values(r).reduce((n, x) => n + x, 0);
const bestViews = (i: Inputs) => (Object.keys(i.manual.clipViews).length ? Math.max(...Object.values(i.manual.clipViews)) : null);
const bestClip = (i: Inputs) => Object.entries(i.manual.clipViews).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
const FRONT_DOOR = "front door tally (ogs-front-door's Tally DO, read over RPC)";

export const BETS: Bet[] = [
  {
    n: 1,
    title: "Push-link invites bring in a second household",
    pass: "≥ 30% of hosted sessions send a cross-household invite, and ≥ 3 new households join through an invite",
    fail: "< 10% of sessions send an invite, or no invitee installs",
    from: startPT("2026-10-19"),
    read: endPT("2026-10-26"),
    checks: (i) => [
      {
        id: "invite-rate",
        label: "Hosted sessions that sent an invite",
        value: i.funnel.sessions === 0 ? null : i.funnel.sessionsWithInvite / i.funnel.sessions,
        target: "≥ 30% (fail < 10%)",
        source: "exact",
        format: "percent",
        note: `${i.funnel.sessionsWithInvite} of ${i.funnel.sessions} sessions (opengame-api D1: couch_sessions, family_invites)`,
      },
      {
        id: "invited-households",
        label: "Invited households that played their first session",
        value: i.funnel.firstSessions,
        target: "≥ 3 (fail 0)",
        source: "exact",
        note: "funnel.first_session (family_invites.first_session_at). Joining TestFlight itself is not visible: this counts the ones who also played.",
      },
      {
        id: "invite-joins",
        label: "Invited households that joined TestFlight",
        value: i.manual.joins.invite,
        target: "≥ 3",
        source: i.manual.joins.invite === null ? "missing" : "manual",
        note: i.manual.joins.invite === null ? "Type it in below from App Store Connect (testers who joined through the invite link)." : `typed in ${i.manual.updatedAt ?? ""}`,
      },
      {
        id: "funnel-steps",
        label: "Invites sent → links opened → TestFlight taps → first sessions",
        value: i.funnel.invitesSent,
        target: "",
        source: "exact",
        note: `${i.funnel.invitesSent} → ${i.funnel.linksOpened} → ${i.funnel.testflightTaps} → ${i.funnel.firstSessions}`,
      },
    ],
    decide: (v) => ({
      // Joined TestFlight (typed in) or, at least, played a first session: either shows the household got in.
      pass: and(at(v("invite-rate"), (r) => r >= 0.3), at(Math.max(v("invite-joins") ?? 0, v("invited-households") ?? 0), (n) => n >= 3)),
      // "No invitee installs" only means something once sessions were hosted (the rate is known).
      fail: or(at(v("invite-rate"), (r) => r < 0.1), v("invite-rate") === null ? null : at(Math.max(v("invite-joins") ?? 0, v("invited-households") ?? 0), (n) => n === 0)),
    }),
  },
  {
    n: 2,
    title: "Short clips of the TV and phones in use find a hook",
    pass: "one clip passes 5,000 views, and ≥ 40 catalogue visits from short-form tags",
    fail: "every clip stays under 1,000 views",
    from: startPT("2026-10-19"),
    read: endPT("2026-10-26"),
    checks: (i) => [
      {
        id: "clip-views",
        label: "Best clip's views",
        value: bestViews(i),
        target: "≥ 5,000 (fail: all < 1,000)",
        source: bestViews(i) === null ? "missing" : "manual",
        note:
          bestViews(i) === null
            ? "TikTok, Reels and Shorts views are only in each app's analytics: type them in below (no API is wired)."
            : `${bestClip(i)} (typed in ${i.manual.updatedAt ?? ""})`,
      },
      {
        id: "clip-landings",
        label: "Best clip's landings on the front door",
        value: Math.max(0, ...Object.values(i.clips).map(sumValues)),
        target: "",
        source: "exact",
        note: `${Object.keys(i.clips).length} clips with landings (utm_campaign = clip id). Links in a bio or caption carry it; most short-form posts can't, so landings undercount.`,
      },
      {
        id: "shortform-visits",
        label: "Catalogue visits from tiktok, reels, shorts",
        value: views(i, SHORT_FORM),
        target: "≥ 40",
        source: "exact",
        note: `${SHORT_FORM.map((s) => `${s} ${i.frontDoor.bySource[s]?.view ?? 0}`).join(", ")} (${FRONT_DOOR})`,
      },
    ],
    decide: (v) => ({
      pass: and(at(v("clip-views"), (n) => n >= 5000), at(v("shortform-visits"), (n) => n >= 40)),
      fail: at(v("clip-views"), (n) => n < 1000),
    }),
  },
  {
    n: 3,
    title: "Show HN: cast web games to your TV, phones are the controllers",
    pass: "front page or ≥ 50 points, ≥ 1,000 catalogue visits and ≥ 100 rounds played",
    fail: "under 10 points",
    from: startPT("2026-10-21"),
    read: endPT("2026-10-23"),
    checks: (i) => [
      {
        id: "hn-points",
        label: "Points on the post",
        value: i.hn.points,
        target: "≥ 50 (fail < 10)",
        source: "exact",
        note: i.hn.points === null ? "No post yet: set HN_ITEM_ID once it's up (read from the HN API)." : "Hacker News API",
      },
      {
        id: "hn-visits",
        label: "Catalogue visits from hn",
        value: views(i, ["hn"]),
        target: "≥ 1,000",
        source: "exact",
        note: FRONT_DOOR,
      },
      {
        id: "hn-rounds",
        label: "Rounds played from ?ref=hn (all try games)",
        value: sumRef((g) => g.rounds, i, "hn"),
        target: "≥ 100",
        source: anySampled(i) ? "estimate" : "exact",
        note: `${i.tryGames.map((g) => `${g.game} ${g.rounds === null ? "n/a" : (g.rounds.hn ?? 0)}`).join(", ") || "no games read yet"} (${anySampled(i) ? `estimates for ${sampledNames(i).join(", ")}: Workers Logs, 1-in-10 sample; the rest counted exactly` : "counted exactly"}${i.tryGames.some((g) => g.rounds === null) ? "; Trivia Jam's round event has no ref" : ""})`,
      },
      {
        id: "hn-launches",
        label: "Try-path link opens from ?ref=hn",
        value: sumRef((g) => g.launches, i, "hn"),
        target: "",
        source: anySampled(i) ? "estimate" : "exact",
        note: i.tryGames.map((g) => `${g.game} ${g.launches.hn ?? 0}`).join(", ") || "no games read yet",
      },
    ],
    decide: (v) => ({
      pass: and(at(v("hn-points"), (n) => n >= 50), at(v("hn-visits"), (n) => n >= 1000), at(v("hn-rounds"), (n) => n >= 100)),
      fail: at(v("hn-points"), (n) => n < 10),
    }),
  },
  {
    n: 4,
    title: "Your web game on a real TV, for AI-assisted devs",
    pass: "≥ 20 waitlist signups, or ≥ 2 outside developers get a game casting",
    fail: "fewer than 5 signups",
    from: startPT("2026-10-19"),
    read: endPT("2026-10-26"),
    checks: (i) => [
      {
        id: "signups",
        label: "Waitlist signups",
        value: i.waitlist.signups,
        target: "≥ 20 (fail < 5)",
        source: "exact",
        note: `ogs-docs waitlist D1${Object.keys(i.waitlist.bySource).length ? `: ${Object.entries(i.waitlist.bySource).map(([s, n]) => `${s} ${n}`).join(", ")}` : ""}`,
      },
      {
        id: "downloads",
        label: "Starter template downloads (starter.tgz)",
        value: i.downloads === null ? null : (i.downloads["/starter.tgz"] ?? 0),
        target: "",
        source: i.downloads === null ? "missing" : "exact",
        note:
          i.downloads === null
            ? "The docs site doesn't count downloads yet: branch claude/docs-download-count (a Pages middleware) needs Jon's deploy."
            : Object.entries(i.downloads).map(([p, n]) => `${p} ${n}`).join(", ") || "none yet",
      },
      {
        id: "outside-devs",
        label: "Outside developers with a game casting",
        value: null,
        target: "≥ 2",
        source: "missing",
        note: "Nothing records a game cast by someone outside the household yet (no event per manifest/appId on first cast).",
      },
    ],
    decide: (v) => ({
      pass: or(at(v("signups"), (n) => n >= 20), at(v("outside-devs"), (n) => n >= 2)),
      fail: at(v("signups"), (n) => n < 5),
    }),
  },
  {
    n: 5,
    title: "One homeschool co-op game day",
    pass: "≥ 8 co-op households join TestFlight (and ≥ 2 host at home by Mon 11-02)",
    fail: "fewer than 3 join",
    from: startPT("2026-10-19"),
    read: endPT("2026-10-26"),
    checks: (i) => [
      {
        id: "coop-joins",
        label: "Co-op households that joined TestFlight",
        value: i.manual.joins.coop,
        target: "≥ 8 (fail < 3)",
        source: i.manual.joins.coop === null ? "missing" : "manual",
        note:
          i.manual.joins.coop === null
            ? "Type it in below from App Store Connect (no ASC API key wired)."
            : `typed in ${i.manual.updatedAt ?? ""}`,
      },
      {
        id: "coop-taps",
        label: "TestFlight taps from the co-op handout (utm coop)",
        value: (i.frontDoor.bySource.coop?.getapp ?? 0) + (i.getApp.coop ?? 0),
        target: "proxy",
        source: "exact",
        note: `${i.frontDoor.bySource.coop?.getapp ?? 0} front-door taps + ${i.getApp.coop ?? 0} /get-app taps; ${i.frontDoor.bySource.coop?.view ?? 0} visits (${FRONT_DOOR})`,
      },
    ],
    decide: (v) => ({
      pass: at(v("coop-joins"), (n) => n >= 8),
      fail: at(v("coop-joins"), (n) => n < 3),
    }),
  },
];

/** Where a bet stands at `now`: running until its read date, then pass, fail, in between, or missing data. */
export function judge(bet: Bet, inputs: Inputs, now: Date): Verdict {
  const checks = bet.checks(inputs);
  const value = (id: string) => checks.find((c) => c.id === id)?.value ?? null;
  const { pass, fail } = bet.decide(value);
  if (now < bet.read) return { status: "running", checks };
  if (fail === true) return { status: "fail", checks };
  if (pass === true) return { status: "pass", checks };
  if (pass === null || fail === null) return { status: "missing", checks };
  return { status: "between", checks };
}
