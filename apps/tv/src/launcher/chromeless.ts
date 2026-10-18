import type { CurrentGame, Manifest } from "@open-game-system/ogs-protocol";

/**
 * What a chrome=none TV shows (docs/acceptance/2026-10-18-cast-chrome-none.feature): this app's game,
 * once the session has its TV page, framed as the launcher frames games (so it gets ogs:start with
 * the couch); before that, the manifest's tvUrl; otherwise black. Never another game's page.
 */
export type ChromelessView = { kind: "frames" } | { kind: "tv-url"; url: string } | { kind: "black" };

export function chromelessView(appId: string, current: CurrentGame | null, manifest: Pick<Manifest, "tvUrl"> | null): ChromelessView {
  if (current && current.appId !== appId) return { kind: "black" };
  if (current?.viewUrl) return { kind: "frames" };
  return manifest?.tvUrl ? { kind: "tv-url", url: manifest.tvUrl } : { kind: "black" };
}
