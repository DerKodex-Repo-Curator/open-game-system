import { z } from "zod";
import type { Inputs, SourceCounts } from "../bets";

/**
 * The front door's tally (apps/front-door, its Tally Durable Object): `summary()` returns running
 * totals per source since it started, with no time filter. The board snapshots those totals on a
 * schedule; a window's counts are the latest totals minus the last snapshot at or before its start.
 */
const Counts = { view: z.number(), getapp: z.number(), try: z.number() };
export const TallySummarySchema = z.object({
  sources: z.array(z.object({ source: z.string(), ...Counts }).passthrough()),
  campaigns: z.array(z.object({ source: z.string(), campaign: z.string(), ...Counts }).passthrough()).default([]),
});

/** `byCampaign` is keyed "<source> <campaign>" (the clips: utm_campaign = clip id). Older snapshots lack it. */
export type Snapshot = { at: string; bySource: Record<string, SourceCounts>; byCampaign?: Record<string, SourceCounts> };

const counts = (r: SourceCounts): SourceCounts => ({ view: r.view, getapp: r.getapp, try: r.try });

export function snapshotOf(summary: unknown, at: Date): Snapshot {
  const { sources, campaigns } = TallySummarySchema.parse(summary);
  return {
    at: at.toISOString(),
    bySource: Object.fromEntries(sources.map((s) => [s.source, counts(s)])),
    byCampaign: Object.fromEntries(campaigns.map((c) => [`${c.source} ${c.campaign}`, counts(c)])),
  };
}

const zero: SourceCounts = { view: 0, getapp: 0, try: 0 };

/** The latest snapshot and the baseline for a window: the last one at or before its start, else the first. */
function window(snapshots: Snapshot[], from: Date): { latest: Snapshot; base: Snapshot | null } | null {
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;
  const before = snapshots.filter((s) => Date.parse(s.at) <= from.getTime());
  const base = before[before.length - 1] ?? snapshots[0] ?? latest;
  return { latest, base: base === latest ? null : base };
}

function diff(now: Record<string, SourceCounts>, then: Record<string, SourceCounts> | undefined): Record<string, SourceCounts> {
  const out: Record<string, SourceCounts> = {};
  for (const [key, n] of Object.entries(now)) {
    const t = then?.[key] ?? zero;
    out[key] = { view: n.view - t.view, getapp: n.getapp - t.getapp, try: n.try - t.try };
  }
  return out;
}

/** Counts since the window's start, from snapshots in time order (an empty list: nothing yet). */
export function frontDoorSince(snapshots: Snapshot[], from: Date): Inputs["frontDoor"] {
  const w = window(snapshots, from);
  if (!w) return { since: from.toISOString(), bySource: {} };
  return { since: (w.base ?? w.latest).at, bySource: diff(w.latest.bySource, w.base?.bySource) };
}

/** Landings per clip and platform since the window's start: { clipId: { tiktok: n, ... } }. */
export function clipsSince(snapshots: Snapshot[], from: Date): Inputs["clips"] {
  const w = window(snapshots, from);
  if (!w) return {};
  const clips: Inputs["clips"] = {};
  for (const [key, c] of Object.entries(diff(w.latest.byCampaign ?? {}, w.base?.byCampaign))) {
    const [source = "", campaign = ""] = key.split(" ");
    if (c.view > 0) clips[campaign] = { ...clips[campaign], [source]: c.view };
  }
  return clips;
}
