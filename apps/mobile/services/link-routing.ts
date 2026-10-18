import { readGameLink, readJoinLink, readPlayLink } from "@open-game-system/ogs-protocol";
import { extractGameUrl } from "./deep-links";

export type LinkTarget =
  | { kind: "play"; appId: string; room: string }
  | { kind: "game"; url: string }
  | { kind: "join"; code: string }
  | { kind: "page"; appId: string };

/** The URL's origin, or undefined when it isn't a URL. */
const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {}
};

/**
 * Where a link or a notification tap goes (spec §9, "Taps and links"): the TV's join QR joins that
 * couch (spec ogs-join); an invite or transfer link
 * starts the game in its room; any page on a catalogue game's origin opens in that game's WebView,
 * exactly there; otherwise the older rules (opengame.org/open?url=…). Null: not a game link.
 */
export function routeLink(url: string, startUrls: readonly string[]): LinkTarget | null {
  const join = readJoinLink(url);
  if (join) return { kind: "join", code: join.code };
  const play = readPlayLink(url);
  if (play) return { kind: "play", appId: play.appId, room: play.room };
  const page = readGameLink(url);
  if (page) return { kind: "page", appId: page.appId };
  const origin = originOf(url);
  if (origin?.startsWith("https://") && startUrls.some((s) => originOf(s) === origin))
    return { kind: "game", url };
  const game = extractGameUrl(url);
  return game ? { kind: "game", url: game } : null;
}

/**
 * Opens a link (from outside the app) or a notification tap's url. A push's url was checked by OGS
 * (the game's origin), so it opens even when it matches nothing yet (the catalogue not loaded).
 */
export function openLink(
  url: string,
  from: "link" | "push",
  deps: {
    startUrls: readonly string[];
    play: (appId: string, room: string) => void;
    game: (url: string) => void;
    join: (code: string) => void;
    page: (appId: string) => void;
  },
): void {
  const target = routeLink(url, deps.startUrls);
  if (target?.kind === "page") deps.page(target.appId);
  else if (target?.kind === "join") deps.join(target.code);
  else if (target?.kind === "play") deps.play(target.appId, target.room);
  else if (target) deps.game(target.url);
  else if (from === "push") deps.game(url);
}

export type LinkFrom = "link" | "push";

/**
 * A link that opens the app before this phone has a profile (a stranger scanning the TV, or an
 * invite): onboarding comes first, then the link goes where it said. Holds the latest one.
 */
export function createLinkHold() {
  let held: { url: string; from: LinkFrom } | null = null;
  return {
    /** Holds the link when there is no profile yet (true); with one, leaves it to open now. */
    offer(url: string, from: LinkFrom, hasProfile: boolean): boolean {
      if (hasProfile) return false;
      held = { url, from };
      return true;
    },
    /** Opens the held link, once. */
    release(open: (url: string, from: LinkFrom) => void): void {
      const link = held;
      held = null;
      if (link) open(link.url, link.from);
    },
  };
}

/**
 * The app's links (spec §9 and ogs-join), with what it knows now. Before this phone has a profile
 * (a stranger's first scan of the TV) a link waits in `hold`; the tabs open it with `openHeld`
 * once onboarding made one. Every link comes through here: Expo Router doesn't route them at a cold
 * start, and `push` navigates, so a screen it did open (app/join/[code], app/play/[appId], which
 * hold the link themselves) isn't opened twice.
 */
export function createLinkOpener(deps: {
  hold: ReturnType<typeof createLinkHold>;
  hasProfile: () => boolean;
  startUrls: () => readonly string[];
  push: (path: string) => void;
  game: (url: string) => void;
}) {
  /** Where each kind of link goes in the app. */
  const go = (url: string, from: LinkFrom) =>
    openLink(url, from, {
      startUrls: deps.startUrls(),
      play: (appId, room) => deps.push(`/play/${appId}?room=${encodeURIComponent(room)}`),
      game: deps.game,
      join: (code) => deps.push(`/join/${code}`),
      page: (appId) => deps.push(`/library/${appId}`),
    });
  const open = (url: string, from: LinkFrom) => {
    if (deps.hold.offer(url, from, deps.hasProfile())) return;
    go(url, from);
  };
  /** A held link, now that there is a profile: it goes where it said (the router's too). */
  return { open, openHeld: go };
}
