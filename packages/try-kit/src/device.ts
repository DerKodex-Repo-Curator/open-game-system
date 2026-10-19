/** Below this width a page is a phone's, not a TV's (TV pages are laid out for 16:9). */
export const NARROW_QUERY = "(max-width: 600px)";

/**
 * A phone or tablet opening the front page is a controller (show it a start page), not the TV. A
 * touch pointer says so; so does a narrow screen, for phone browsers that report a mouse.
 */
export function isControllerDevice(input: { coarse: boolean; narrow: boolean }): boolean {
  return input.coarse || input.narrow;
}

/**
 * "No phone handy? Play on this computer": a visitor alone at a laptop plays a seat in a window on
 * the TV's own computer. Only on a TV someone sits at (a plain browser, not the OGS TV or a cloud
 * stream), not on a touch-screen TV (a second tab would cover it), and only while a player is needed.
 */
export function offerThisComputer(input: { plainBrowserTv: boolean; touchTv: boolean; needsPlayer: boolean }): boolean {
  return input.plainBrowserTv && !input.touchTv && input.needsPlayer;
}
