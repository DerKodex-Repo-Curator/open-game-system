import { z } from "zod";
import type { Inputs } from "../bets";
import type { D1Like } from "./d1";

const Row = z.object({ source: z.string().nullable(), n: z.number() });

/** Bet 4: developer waitlist signups since the window opened, by utm_source (ogs-docs' D1, read-only). */
export async function readWaitlist(db: D1Like, from: number): Promise<Inputs["waitlist"]> {
  const { results } = await db
    .prepare("SELECT utm_source AS source, COUNT(*) AS n FROM waitlist WHERE created_at >= ? GROUP BY utm_source")
    .bind(new Date(from).toISOString())
    .all();
  const bySource: Record<string, number> = {};
  let signups = 0;
  for (const raw of results) {
    const r = Row.parse(raw);
    bySource[r.source ?? "direct"] = r.n;
    signups += r.n;
  }
  return { signups, bySource };
}
