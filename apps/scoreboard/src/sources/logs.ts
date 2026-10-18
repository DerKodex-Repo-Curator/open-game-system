import { z } from "zod";
import type { TryGame } from "../bets";

/** The part of the Analytics SQL binding the board uses (tests pass a stand-in). */
export interface SqlLike {
  query(req: { query: string; params?: Record<string, string | number> }): Promise<{ data: unknown[] }>;
}

/** Each try Worker and the wide event that marks a round started. `ref: false`: the event has no ref. */
export const TRY_GAMES: { game: string; script: string; round: { event: string; phase?: string }; ref?: false }[] = [
  { game: "Rocket Crew", script: "rocket-crew-try", round: { event: "rocket.round", phase: "launched" } },
  { game: "Trivia Jam", script: "trivia-jam-try", round: { event: "client.round_started" }, ref: false },
  { game: "Midnight Museum", script: "midnight-museum-try", round: { event: "museum.case", phase: "started" } },
  { game: "Peekaboo Garden", script: "peekaboo-garden-try", round: { event: "garden.round" } },
  { game: "Night Flight", script: "night-flight-try", round: { event: "nightflight.round", phase: "dealt" } },
  { game: "Bake Shop", script: "bake-shop-try", round: { event: "bake.round" } },
  { game: "Story Nook", script: "story-nook-try", round: { event: "story.round", phase: "opened" } },
];

const Row = z.object({ ref: z.string().nullable(), n: z.number() });

/** Front-page opens (the try link) by ?ref=. Query parameters are indexed as $workers.event.search.*. */
const LAUNCHES = `SELECT attributes['$workers.event.search.ref'] AS ref, COUNT(*) AS n FROM logs.workersLogs
  WHERE timestamp >= $start AND scriptName = $script AND attributes['$workers.event.path'] = '/' AND attributes['$workers.eventType'] = 'fetch'
  GROUP BY attributes['$workers.event.search.ref']`;

const rounds = (phase: boolean) => `SELECT attributes['ref'] AS ref, COUNT(*) AS n FROM logs.workersLogs
  WHERE timestamp >= $start AND scriptName = $script AND attributes['event'] = $event${phase ? " AND attributes['phase'] = $phase" : ""}
  GROUP BY attributes['ref']`;

async function byRef(sql: SqlLike, query: string, params: Record<string, string>, onError: (e: unknown) => void): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const { data } = await sql.query({ query, params });
    for (const raw of data) {
      const r = Row.safeParse(raw);
      if (r.success) out[r.data.ref ?? "direct"] = (out[r.data.ref ?? "direct"] ?? 0) + r.data.n;
    }
  } catch (e) {
    // A query that fails (quota, a dataset hiccup) leaves this count empty; the next refresh retries.
    onError(e);
  }
  return out;
}

/**
 * Bet 3's try-path numbers from Workers Logs (what the try Workers already log). Workers Logs keeps a
 * sample (sampleInterval 10 on this account) and COUNT is weighted by it, so these are estimates.
 */
export async function readTryGames(sql: SqlLike, from: Date, onError: (e: unknown) => void = () => {}): Promise<TryGame[]> {
  const start = from.toISOString();
  return Promise.all(
    TRY_GAMES.map(async (g) => {
      const launches = await byRef(sql, LAUNCHES, { start, script: g.script }, onError);
      const params: Record<string, string> = { start, script: g.script, event: g.round.event, ...(g.round.phase ? { phase: g.round.phase } : {}) };
      const counted = g.ref === false ? null : await byRef(sql, rounds(g.round.phase !== undefined), params, onError);
      return { game: g.game, script: g.script, launches, rounds: counted, sampled: true };
    }),
  );
}
