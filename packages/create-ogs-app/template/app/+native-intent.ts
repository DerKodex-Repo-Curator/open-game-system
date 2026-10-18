/**
 * Every link that opens the app (__OGS_LINK_BASE__/…, a push tap) lands on the one screen.
 * <OgsShell /> reads the link itself and opens that page of the game.
 */
export function redirectSystemPath(_event: { path: string; initial: boolean }): string {
  return "/";
}
