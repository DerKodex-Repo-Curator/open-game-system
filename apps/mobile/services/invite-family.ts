/** The game an invite another family is for: the one this household played last, if it's listed. */
export function inviteGame<G extends { appId: string; name: string }>(
  sittings: readonly { appId: string; updatedAt: number }[],
  games: readonly G[],
): { appId: string; name: string } | null {
  const last = [...sittings].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const game = last && games.find((g) => g.appId === last.appId);
  return game ? { appId: game.appId, name: game.name } : null;
}
