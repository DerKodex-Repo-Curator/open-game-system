import { z } from "zod";
import type { SqlLike } from "./logs";

/** The Analytics Engine dataset the counters write (tail of the try Workers, /get-app, docs downloads). */
export const DATASET = "ogs_try_events";

const Row = z.object({ script: z.string(), kind: z.string(), ref: z.string(), n: z.number() });

export type Counters = { get(script: string, kind: string): Record<string, number> };

/** Exact counts since `from`, by script (index1), kind (blob1) and ref (blob2). */
export async function readCounters(sql: SqlLike, from: Date): Promise<Counters> {
  const { data } = await sql.query({
    query: `SELECT index1 AS script, blob1 AS kind, blob2 AS ref, COUNT(*) AS n FROM events.analyticsEngine."${DATASET}"
      WHERE timestamp >= $start GROUP BY index1, blob1, blob2`,
    params: { start: from.toISOString() },
  });
  const counts = new Map<string, Record<string, number>>();
  for (const raw of data) {
    const r = Row.safeParse(raw);
    if (!r.success) continue;
    const key = `${r.data.script}|${r.data.kind}`;
    counts.set(key, { ...counts.get(key), [r.data.ref]: r.data.n });
  }
  return { get: (script, kind) => counts.get(`${script}|${kind}`) ?? {} };
}

/** "rocket-crew-try launch 5, get-app get_app 1 (last 24 h)": what reached the dataset lately. */
export async function recentTotals(sql: SqlLike, now: Date): Promise<string> {
  const { data } = await sql.query({
    query: `SELECT index1 AS script, blob1 AS kind, blob2 AS ref, COUNT(*) AS n FROM events.analyticsEngine."${DATASET}"
      WHERE timestamp >= $start GROUP BY index1, blob1, blob2`,
    params: { start: new Date(now.getTime() - 24 * 3600_000).toISOString() },
  });
  const totals = new Map<string, number>();
  for (const raw of data) {
    const r = Row.safeParse(raw);
    if (r.success) totals.set(`${r.data.script} ${r.data.kind}`, (totals.get(`${r.data.script} ${r.data.kind}`) ?? 0) + r.data.n);
  }
  if (totals.size === 0) return "no data points in the last 24 h";
  return `${[...totals].map(([k, n]) => `${k} ${n}`).join(", ")} (last 24 h)`;
}
