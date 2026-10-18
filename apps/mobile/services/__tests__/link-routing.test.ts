import { createLinkHold, openLink, routeLink } from "../link-routing";

jest.mock("../deep-links", () => ({
  extractGameUrl: (url: string) =>
    url.startsWith("https://opengame.org/open?url=")
      ? decodeURIComponent(url.split("url=")[1])
      : null,
}));

const startUrls = ["https://triviajam.tv/", "https://codebreakers.jonathanrmumm.workers.dev/"];

describe("where a link or a notification tap goes", () => {
  it("an invite or transfer link with a room starts the game in that room", () => {
    expect(routeLink("https://opengame.org/play/night-flight?room=KQTP", startUrls)).toEqual({
      kind: "play",
      appId: "night-flight",
      room: "KQTP",
    });
  });

  it("any page on a catalogue game's origin opens that page in the game's WebView", () => {
    for (const url of [
      "https://triviajam.tv/",
      "https://triviajam.tv/host/new",
      "https://codebreakers.jonathanrmumm.workers.dev/room/KQTP?x=1",
    ])
      expect(routeLink(url, startUrls)).toEqual({ kind: "game", url });
  });

  it("another origin is not a game, unless the old /open link names one", () => {
    expect(routeLink("https://elsewhere.example/", startUrls)).toBeNull();
    expect(routeLink("http://triviajam.tv/", startUrls)).toBeNull();
    expect(
      routeLink(
        `https://opengame.org/open?url=${encodeURIComponent("https://triviajam.tv/games/a")}`,
        startUrls,
      ),
    ).toEqual({
      kind: "game",
      url: "https://triviajam.tv/games/a",
    });
  });

  it("only https game origins open in the app, even if a start URL is http (local dev)", () => {
    expect(routeLink("http://dev.local:8787/room/A", ["http://dev.local:8787/"])).toBeNull();
  });

  it("with no catalogue loaded yet, falls back to the old rules", () => {
    expect(routeLink("https://triviajam.tv/host/new", [])).toBeNull();
  });

  it("a string that isn't a URL is nothing", () => {
    expect(routeLink("not a url", startUrls)).toBeNull();
  });

  it("ignores start URLs that don't parse", () => {
    expect(routeLink("https://triviajam.tv/", ["::", "https://triviajam.tv/"])).toEqual({
      kind: "game",
      url: "https://triviajam.tv/",
    });
  });
});

describe("a join link (the TV's QR, opengame.org/join/<code>)", () => {
  it("joins that TV's couch with its code", () => {
    for (const url of ["https://opengame.org/join/NT9WPH", "opengame://join/nt9wph"])
      expect(routeLink(url, startUrls)).toEqual({ kind: "join", code: "NT9WPH" });
  });

  it("is nothing when the code can't be a TV code", () => {
    expect(routeLink("https://opengame.org/join/NT9", startUrls)).toBeNull();
  });
});

describe("opening a link or a tap", () => {
  const run = (url: string, from: "link" | "push", urls = startUrls) => {
    const went: string[] = [];
    openLink(url, from, {
      startUrls: urls,
      play: (a, r) => went.push(`play:${a}:${r}`),
      game: (u) => went.push(`game:${u}`),
      join: (c) => went.push(`join:${c}`),
    });
    return went;
  };

  it("a join link joins the couch", () => {
    expect(run("https://opengame.org/join/NT9WPH", "link")).toEqual(["join:NT9WPH"]);
  });

  it("a play link starts the game in its room", () => {
    expect(run("https://opengame.org/play/night-flight?room=KQTP", "link")).toEqual([
      "play:night-flight:KQTP",
    ]);
  });

  it("a game page opens in the game", () => {
    expect(run("https://triviajam.tv/host/new", "link")).toEqual([
      "game:https://triviajam.tv/host/new",
    ]);
  });

  it("an unknown link does nothing, but a push's url still opens (catalogue not loaded yet)", () => {
    expect(run("https://elsewhere.example/", "link")).toEqual([]);
    expect(run("https://codebreakers.jonathanrmumm.workers.dev/room/A", "push", [])).toEqual([
      "game:https://codebreakers.jonathanrmumm.workers.dev/room/A",
    ]);
  });
});

// A stranger's first tap: the link (an invite, the TV's QR) opens the app before it has a profile.
// Onboarding comes first; the link must still go where it said once the profile is made.
describe("a link that arrives before this phone has a profile", () => {
  it("waits for the profile, then opens once", () => {
    const hold = createLinkHold();
    const went: string[] = [];
    const open = (url: string, from: string) => went.push(`${url}|${from}`);
    expect(hold.offer("https://opengame.org/join/NT9WPH", "link", false)).toBe(true);
    expect(went).toEqual([]);
    hold.release(open);
    hold.release(open);
    expect(went).toEqual(["https://opengame.org/join/NT9WPH|link"]);
  });

  it("keeps only the latest link", () => {
    const hold = createLinkHold();
    hold.offer("https://opengame.org/join/AAAAAA", "link", false);
    hold.offer("https://opengame.org/join/NT9WPH", "push", false);
    const went: string[] = [];
    hold.release((u, f) => went.push(`${u}|${f}`));
    expect(went).toEqual(["https://opengame.org/join/NT9WPH|push"]);
  });

  it("with a profile, a link is not held: it opens now", () => {
    const hold = createLinkHold();
    expect(hold.offer("https://opengame.org/join/NT9WPH", "link", true)).toBe(false);
    const went: string[] = [];
    hold.release((u, f) => went.push(`${u}|${f}`));
    expect(went).toEqual([]);
  });
});
