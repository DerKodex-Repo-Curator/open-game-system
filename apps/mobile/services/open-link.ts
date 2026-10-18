import { readJoinLink } from "@open-game-system/ogs-protocol";
import { router } from "expo-router";
import { setGameUrl } from "./game-url-store";
import { type LinkFrom, openLink } from "./link-routing";
import { appState, linkHold } from "./runtime";

/**
 * A link or a notification tap (spec §9), with what the app knows now. Before this phone has a
 * profile (a stranger's first scan of the TV) it waits: the index route opens it after onboarding.
 */
export const open = (url: string, from: LinkFrom) => {
  // Expo Router opens the app scheme's join links itself (app/join/[code].tsx, which holds them
  // until there is a profile); a universal link (https://opengame.org/join/…) only reaches here.
  if (from === "link" && url.startsWith("opengame") && readJoinLink(url)) return;
  if (linkHold.offer(url, from, appState.getSnapshot().identity !== null)) return;
  openLink(url, from, {
    startUrls: appState.getSnapshot().catalogue.map((g) => g.startUrl),
    play: (appId, room) => router.push(`/play/${appId}?room=${encodeURIComponent(room)}`),
    game: setGameUrl,
    join: (code) => router.push(`/join/${code}`),
  });
};

/** A link held through onboarding, now that there is a profile: it goes where it said. */
export const openHeld = (url: string, from: LinkFrom) => {
  const join = readJoinLink(url);
  if (join) router.push(`/join/${join.code}`);
  else open(url, from);
};
