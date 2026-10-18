/**
 * The line under the game's name on the loading card: the catalogue's tagline for a known game
 * (its host, e.g. "localhost" or "rocket-crew.….workers.dev", means nothing to a player), and the
 * host only for a game the catalogue doesn't know, so you still see what you're opening.
 */
export function loadingCaption(game: { tagline: string } | null, uri: string): string {
  if (game) return game.tagline;
  try {
    return new URL(uri).hostname;
  } catch {
    return uri;
  }
}
