/**
 * Bet 4's download counts (outside developers trying OGS): each GET of /starter.tgz or /pkg/*.tgz is one
 * Analytics Engine data point in the bets scoreboard's dataset (open-game-system apps/scoreboard reads
 * index "docs", kind "download", by path). The file itself is still served as a static asset.
 */
export type DataPoint = { indexes: string[]; blobs: string[]; doubles: number[] };
export type Counter = { writeDataPoint(point: DataPoint): void };

const BOT = /bot|crawl|spider|slurp|preview|fetch|monitor/i;
const REF = /^[a-z0-9_-]{1,32}$/;

export function countDownload(request: Request, counter: Counter | undefined): void {
  if (!counter || request.method !== "GET" || BOT.test(request.headers.get("user-agent") ?? "")) return;
  const url = new URL(request.url);
  const source = (url.searchParams.get("utm_source") ?? "").toLowerCase();
  counter.writeDataPoint({ indexes: ["docs"], blobs: ["download", url.pathname, REF.test(source) ? source : ""], doubles: [1] });
}
