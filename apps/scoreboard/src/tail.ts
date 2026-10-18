import { TRY_GAMES } from "./sources/logs";

/**
 * The try Workers that list this Worker as a tail consumer (their `[env.try]` only). Bake Shop and
 * Story Nook (being migrated) and Midnight Museum (another session's) are not tailed: their counts
 * stay the Workers Logs estimate.
 */
export const TAILED = new Set(["rocket-crew-try", "trivia-jam-try", "peekaboo-garden-try", "night-flight-try"]);

/** The fields of a TraceItem the counter reads (TraceItem satisfies it). */
export type TailItem = {
  scriptName: string | null;
  event: unknown;
  logs: readonly { message: unknown }[];
};

const REF = /^[a-z0-9_-]{1,32}$/;
const slug = (v: unknown) => (typeof v === "string" && REF.test(v.toLowerCase()) ? v.toLowerCase() : "direct");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function requestUrl(event: unknown): URL | null {
  if (!isRecord(event) || !isRecord(event.request) || typeof event.request.url !== "string") return null;
  try {
    return new URL(event.request.url);
  } catch {
    return null;
  }
}

/**
 * One data point per front-page open (`launch`, its ?ref=) and per round started (`round`, the
 * event's ref), for the tailed try Workers. Every log reaches a tail Worker: these counts are exact.
 */
export function datapointsFrom(items: readonly TailItem[]): AnalyticsEngineDataPoint[] {
  const points: AnalyticsEngineDataPoint[] = [];
  for (const item of items) {
    const script = item.scriptName ?? "";
    const game = TRY_GAMES.find((g) => g.script === script);
    if (!game || !TAILED.has(script)) continue;
    const url = requestUrl(item.event);
    if (url && url.pathname === "/") points.push({ indexes: [script], blobs: ["launch", slug(url.searchParams.get("ref")), ""], doubles: [1] });
    for (const log of item.logs) {
      const fields = Array.isArray(log.message) ? log.message.find(isRecord) : undefined;
      if (!fields || fields.event !== game.round.event) continue;
      if (game.round.phase !== undefined && fields.phase !== game.round.phase) continue;
      points.push({ indexes: [script], blobs: ["round", slug(fields.ref), game.round.event], doubles: [1] });
    }
  }
  return points;
}
