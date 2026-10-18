import { z } from "zod";
import type { Inputs, SourceCounts } from "../bets";

/**
 * The front door's tally (apps/front-door, its Tally Durable Object): `summary()` returns running
 * totals per source since it started, with no time filter. The board snapshots those totals on a
 * schedule; a window's counts are the latest totals minus the last snapshot at or before its start.
 */
export const TallySummarySchema = z.object({
  sources: z.array(z.object({ source: z.string(), view: z.number(), getapp: z.number(), try: z.number() }).passthrough()),
});

export type Snapshot = { at: string; bySource: Record<string, SourceCounts> };

export function snapshotOf(summary: unknown, at: Date): Snapshot {
  const { sources } = TallySummarySchema.parse(summary);
  return { at: at.toISOString(), bySource: Object.fromEntries(sources.map((s) => [s.source, { view: s.view, getapp: s.getapp, try: s.try }])) };
}

const zero: SourceCounts = { view: 0, getapp: 0, try: 0 };

/** Counts since the window's start, from snapshots in time order (an empty list: nothing yet). */
export function frontDoorSince(snapshots: Snapshot[], from: Date): Inputs["frontDoor"] {
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return { since: from.toISOString(), bySource: {} };
  const before = snapshots.filter((s) => Date.parse(s.at) <= from.getTime());
  const base = before[before.length - 1] ?? snapshots[0] ?? latest;
  const bySource: Record<string, SourceCounts> = {};
  for (const [source, now] of Object.entries(latest.bySource)) {
    const then = base === latest ? zero : (base.bySource[source] ?? zero);
    bySource[source] = { view: now.view - then.view, getapp: now.getapp - then.getapp, try: now.try - then.try };
  }
  return { since: base.at, bySource };
}
