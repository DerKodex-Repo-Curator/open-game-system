import { webViewUrlFor } from "../shell-links";

const config = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone?x=1",
  linkDomains: ["rocketcrew.tv", "www.rocketcrew.tv"],
};

describe("webViewUrlFor", () => {
  it("maps opengame.org/play/<appId>/<rest> onto the game's origin, keeping the query", () => {
    expect(webViewUrlFor("https://opengame.org/play/rocket-crew/join/PQWS?t=abc", config)).toBe(
      "https://play.rocketcrew.tv/join/PQWS?t=abc",
    );
  });

  it("keeps the hash too", () => {
    expect(webViewUrlFor("https://opengame.org/play/rocket-crew/r/1#seat", config)).toBe(
      "https://play.rocketcrew.tv/r/1#seat",
    );
  });

  it("maps opengame.org/play/<appId> and /play/<appId>/ to the game's origin root", () => {
    expect(webViewUrlFor("https://opengame.org/play/rocket-crew", config)).toBe(
      "https://play.rocketcrew.tv/",
    );
    expect(webViewUrlFor("https://opengame.org/play/rocket-crew/", config)).toBe(
      "https://play.rocketcrew.tv/",
    );
    expect(webViewUrlFor("https://opengame.org/play/rocket-crew?t=1", config)).toBe(
      "https://play.rocketcrew.tv/?t=1",
    );
  });

  it("accepts www.opengame.org", () => {
    expect(webViewUrlFor("https://www.opengame.org/play/rocket-crew/a", config)).toBe(
      "https://play.rocketcrew.tv/a",
    );
  });

  it("ignores another game's /play link and other opengame.org paths", () => {
    expect(webViewUrlFor("https://opengame.org/play/night-flight/a", config)).toBeNull();
    expect(webViewUrlFor("https://opengame.org/play/rocket-crewx/a", config)).toBeNull();
    expect(webViewUrlFor("https://opengame.org/join/ABCD", config)).toBeNull();
  });

  it("opens a URL on a configured link domain as it is", () => {
    expect(webViewUrlFor("https://rocketcrew.tv/join/PQWS?t=1", config)).toBe(
      "https://rocketcrew.tv/join/PQWS?t=1",
    );
    expect(webViewUrlFor("https://WWW.rocketcrew.tv/a", config)).toBe(
      "https://WWW.rocketcrew.tv/a",
    );
  });

  it("opens a URL on the game's own origin (a push link) as it is", () => {
    expect(webViewUrlFor("https://play.rocketcrew.tv/room/9?from=push", config)).toBe(
      "https://play.rocketcrew.tv/room/9?from=push",
    );
  });

  it("refuses look-alike hosts, other schemes and junk", () => {
    expect(webViewUrlFor("https://evilrocketcrew.tv/a", config)).toBeNull();
    expect(webViewUrlFor("https://rocketcrew.tv.evil.com/a", config)).toBeNull();
    expect(webViewUrlFor("http://rocketcrew.tv/a", config)).toBeNull();
    expect(webViewUrlFor("http://play.rocketcrew.tv/a", config)).toBeNull();
    expect(webViewUrlFor("https://play.rocketcrew.tv:8443/a", config)).toBeNull();
    expect(webViewUrlFor("http://opengame.org/play/rocket-crew/a", config)).toBeNull();
    expect(webViewUrlFor("javascript:alert(1)", config)).toBeNull();
    expect(webViewUrlFor("rocketcrew://open", config)).toBeNull();
    expect(webViewUrlFor("", config)).toBeNull();
    expect(webViewUrlFor("https://user@rocketcrew.tv/a", config)).toBeNull();
  });

  it("works with no link domains", () => {
    const bare = { ...config, linkDomains: [] };
    expect(webViewUrlFor("https://rocketcrew.tv/a", bare)).toBeNull();
    expect(webViewUrlFor("https://opengame.org/play/rocket-crew/a", bare)).toBe(
      "https://play.rocketcrew.tv/a",
    );
  });

  it("keeps a port on the game's origin when mapping", () => {
    const local = { ...config, gameUrl: "https://localhost:5173/phone" };
    expect(webViewUrlFor("https://opengame.org/play/rocket-crew/a?b=1", local)).toBe(
      "https://localhost:5173/a?b=1",
    );
    expect(webViewUrlFor("https://localhost:5173/x", local)).toBe("https://localhost:5173/x");
  });
});
