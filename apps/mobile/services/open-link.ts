import { router } from "expo-router";
import { setGameUrl } from "./game-url-store";
import { createLinkOpener } from "./link-routing";
import { appState, linkHold } from "./runtime";

/** The app's links and notification taps (link-routing's createLinkOpener, wired to the app). */
export const { open, openHeld } = createLinkOpener({
  hold: linkHold,
  hasProfile: () => appState.getSnapshot().identity !== null,
  startUrls: () => appState.getSnapshot().catalogue.map((g) => g.startUrl),
  push: (path) => router.push(path),
  game: setGameUrl,
});
