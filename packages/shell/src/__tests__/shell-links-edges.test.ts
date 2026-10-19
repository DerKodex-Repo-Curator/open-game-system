import { webViewUrlFor } from "../shell-links";

const config = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  linkDomains: ["rocketcrew.tv"],
};
const open = (url: string) => webViewUrlFor(url, config);

describe("webViewUrlFor, edges", () => {
  it("only https links that start the string, with nothing after a line break", () => {
    expect(open("nothttps://rocketcrew.tv/a")).toBeNull();
    expect(open("https://rocketcrew.tv/a\nb")).toBeNull();
  });

  it("refuses a link with credentials in it", () => {
    expect(open("https://user@rocketcrew.tv/a")).toBeNull();
  });

  it("an OGS link with a port is still an OGS link", () => {
    expect(open("https://opengame.org:443/play/rocket-crew/r/1")).toBe(
      "https://play.rocketcrew.tv/r/1",
    );
  });

  it("only a port at the end of the authority is a port", () => {
    expect(open("https://opengame.or:1g/play/rocket-crew/r/1")).toBeNull();
  });

  it("a link domain with a port is not the link domain", () => {
    expect(open("https://rocketcrew.tv:8443/a")).toBeNull();
  });

  it("opengame.org/play/<appId>#hash opens the game's root with the hash", () => {
    expect(open("https://opengame.org/play/rocket-crew#seat")).toBe(
      "https://play.rocketcrew.tv/#seat",
    );
  });

  it("the custom scheme must start the link", () => {
    expect(open("1rocket-crew://play/r/1")).toBeNull();
  });

  it("the dev client's own link, exactly, is not the game's", () => {
    expect(open("rocket-crew://expo-development-client")).toBeNull();
  });

  it("a game route named expo-development-client under play/ is the game's", () => {
    expect(open("rocket-crew://play/expo-development-client/x")).toBe(
      "https://play.rocketcrew.tv/expo-development-client/x",
    );
  });

  it("<scheme>://play alone opens the game's root", () => {
    expect(open("rocket-crew://play")).toBe("https://play.rocketcrew.tv/");
  });

  it("nothing opens when the game URL isn't https", () => {
    expect(webViewUrlFor("https://rocketcrew.tv/a", { ...config, gameUrl: "http://x.test" })).toBe(
      null,
    );
    expect(webViewUrlFor("rocket-crew://a", { ...config, gameUrl: "http://x.test" })).toBeNull();
  });
});
