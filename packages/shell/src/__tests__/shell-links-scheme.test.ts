import { webViewUrlFor } from "../shell-links";

// Custom-scheme links (`<scheme>://…`): what tests and apps without verified link domains use.
const config = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone?x=1",
  linkDomains: [],
};

describe("webViewUrlFor with the app's custom scheme", () => {
  it("maps <scheme>://play/<appId>/<rest> like opengame.org/play/<appId>/<rest>", () => {
    expect(webViewUrlFor("rocket-crew://play/rocket-crew/join/ABCD?t=1#seat", config)).toBe(
      "https://play.rocketcrew.tv/join/ABCD?t=1#seat",
    );
    expect(webViewUrlFor("rocket-crew://play/rocket-crew", config)).toBe(
      "https://play.rocketcrew.tv/",
    );
  });

  it("maps <scheme>://play/<rest> onto the game's origin + /<rest>", () => {
    expect(webViewUrlFor("rocket-crew://play/join/ABCD", config)).toBe(
      "https://play.rocketcrew.tv/join/ABCD",
    );
    expect(webViewUrlFor("rocket-crew://play", config)).toBe("https://play.rocketcrew.tv/");
    expect(webViewUrlFor("rocket-crew://play?t=1", config)).toBe("https://play.rocketcrew.tv/?t=1");
  });

  it("maps <scheme>://<rest> onto the game's origin + /<rest>", () => {
    expect(webViewUrlFor("rocket-crew://join/ABCD", config)).toBe(
      "https://play.rocketcrew.tv/join/ABCD",
    );
    expect(webViewUrlFor("rocket-crew://play.html", config)).toBe(
      "https://play.rocketcrew.tv/play.html",
    );
    expect(webViewUrlFor("rocket-crew:///join/ABCD", config)).toBe(
      "https://play.rocketcrew.tv/join/ABCD",
    );
    expect(webViewUrlFor("rocket-crew://", config)).toBe("https://play.rocketcrew.tv/");
    expect(webViewUrlFor("rocket-crew://?t=1", config)).toBe("https://play.rocketcrew.tv/?t=1");
  });

  it("matches the scheme in any case", () => {
    expect(webViewUrlFor("Rocket-Crew://join/A", config)).toBe("https://play.rocketcrew.tv/join/A");
  });

  it("uses the app's own schemes when it has them, else the appId", () => {
    const own = { ...config, schemes: ["rocketcrew", "tv.rocketcrew.app"] };
    expect(webViewUrlFor("rocketcrew://join/A", own)).toBe("https://play.rocketcrew.tv/join/A");
    expect(webViewUrlFor("tv.rocketcrew.app://join/A", own)).toBe(
      "https://play.rocketcrew.tv/join/A",
    );
    expect(webViewUrlFor("rocket-crew://join/A", own)).toBeNull();
  });

  it("ignores other schemes, look-alikes and the dev client's own links", () => {
    expect(webViewUrlFor("night-flight://join/A", config)).toBeNull();
    expect(webViewUrlFor("rocket-crewx://join/A", config)).toBeNull();
    expect(webViewUrlFor("rocket-crew:join/A", config)).toBeNull();
    expect(webViewUrlFor("rocket-crew://expo-development-client/?url=http://x", config)).toBeNull();
    expect(webViewUrlFor("exp+rocket-crew://expo-development-client/?url=x", config)).toBeNull();
  });

  it("never lets a scheme link leave the game's origin", () => {
    expect(webViewUrlFor("rocket-crew://play/rocket-crew//evil.com/x", config)).toBe(
      "https://play.rocketcrew.tv/evil.com/x",
    );
    expect(webViewUrlFor("rocket-crew://@evil.com/x", config)).toBe(
      "https://play.rocketcrew.tv/@evil.com/x",
    );
  });
});
