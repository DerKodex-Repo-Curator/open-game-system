/**
 * Cast from a single-game app: the receiver loads the OGS launcher as the OGS app does (same `api`
 * and launcher `token`, through LOAD_VIEW) with `chrome=none&app=<appId>` added, so the launcher
 * shows that game's manifest `tvUrl` full screen with no launcher frame.
 *
 * String work, not `URL`: React Native's URL has no working `searchParams.set`.
 */
export function castLauncherUrl(launcherUrl: string, appId: string): string {
  const hashAt = launcherUrl.indexOf("#");
  const hash = hashAt === -1 ? "" : launcherUrl.slice(hashAt);
  const beforeHash = hashAt === -1 ? launcherUrl : launcherUrl.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);
  const kept = query
    .split("&")
    // Stryker disable next-line StringLiteral: equivalent, split always gives a first element
    .filter((pair) => pair !== "" && !["chrome", "app"].includes(pair.split("=")[0] ?? ""));
  const params = [...kept, "chrome=none", `app=${encodeURIComponent(appId)}`];
  return `${base}?${params.join("&")}${hash}`;
}
