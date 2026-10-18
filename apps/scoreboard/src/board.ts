import { BETS, type Inputs } from "./bets";
import type { D1Like } from "./sources/d1";
import { readFunnel } from "./sources/funnel";
import { frontDoorSince, type Snapshot } from "./sources/frontdoor";
import { readTryGames, type SqlLike } from "./sources/logs";
import { readWaitlist } from "./sources/waitlist";

/** Where the numbers come from. The Worker wires the real bindings; tests pass synthetic ones. */
export type Sources = {
  /** opengame-api's D1 (couch_sessions, family_invites), read-only. */
  api: D1Like;
  /** ogs-docs' waitlist D1, read-only. */
  waitlist: D1Like;
  /** Workers Logs (the Analytics SQL binding). */
  sql: SqlLike;
  hn: () => Promise<Inputs["hn"]>;
};

/** Each bet window's inputs, keyed by the window's start (ISO). */
export type Windows = Record<string, Inputs>;

/** 15-minute snapshots for a month. */
export const MAX_SNAPSHOTS = 4 * 24 * 31;

export function addSnapshot(list: Snapshot[], snap: Snapshot, max = MAX_SNAPSHOTS): Snapshot[] {
  return [...list, snap].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-max);
}

/** Each source's last read: "ok", or the error it gave (shown on the page). */
export type Health = Record<string, string>;

/**
 * Reads every source once per distinct bet window (bet 3 starts Wed, the rest Mon). A source that
 * fails gives empty numbers and its error in `health`; the others still count.
 */
export async function gather(sources: Sources, snapshots: Snapshot[], now: Date, health: Health = {}): Promise<Windows> {
  const starts = [...new Set(BETS.map((b) => b.from.getTime()))];
  const report = (name: string, e: unknown) => {
    health[name] = String(e).slice(0, 300);
  };
  const attempt = async <T>(name: string, read: () => Promise<T>, empty: T): Promise<T> => {
    try {
      const out = await read();
      health[name] ??= "ok";
      return out;
    } catch (e) {
      report(name, e);
      return empty;
    }
  };
  const hn = await attempt("hn", sources.hn, { points: null });
  const entries = await Promise.all(
    starts.map(async (from): Promise<[string, Inputs]> => {
      const [funnel, waitlist, tryGames] = await Promise.all([
        attempt("api", () => readFunnel(sources.api, from, now.getTime()), { sessions: 0, sessionsWithInvite: 0, invitesSent: 0, linksOpened: 0, testflightTaps: 0, firstSessions: 0 }),
        attempt("waitlist", () => readWaitlist(sources.waitlist, from), { signups: 0, bySource: {} }),
        attempt("logs", () => readTryGames(sources.sql, new Date(from), (e) => report("logs", e)), []),
      ]);
      return [new Date(from).toISOString(), { funnel, waitlist, tryGames, hn, frontDoor: frontDoorSince(snapshots, new Date(from)) }];
    }),
  );
  return Object.fromEntries(entries);
}
