import { router } from "expo-router";
import { setGameUrl } from "./game-url-store";
import { createLinkOpener } from "./link-routing";
import { appState, linkHold } from "./runtime";

/** The app's links and notification taps (link-routing's createLinkOpener, wired to the app). */
export const { open, openHeld } = createLinkOpener({
  hold: linkHold,
  hasProfile: () => appState.getSnapshot().identity !== null,
  startUrls: () => appState.getSnapshot().catalogue.map((g) => g.startUrl),
  // navigate, not push: the screen a link names opens once even if Expo Router opened it too.
  push: (path) => router.navigate(path),
  game: setGameUrl,
});
