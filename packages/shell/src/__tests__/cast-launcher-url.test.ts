import { castLauncherUrl } from "../cast-launcher-url";

describe("castLauncherUrl", () => {
  const launcher = "https://tv.opengame.org/?api=https%3A%2F%2Fapi.opengame.org&token=t.k";

  it("adds chrome=none and the app id, keeping api and token", () => {
    const url = new URL(castLauncherUrl(launcher, "rocket-crew"));
    expect(url.origin).toBe("https://tv.opengame.org");
    expect(url.searchParams.get("api")).toBe("https://api.opengame.org");
    expect(url.searchParams.get("token")).toBe("t.k");
    expect(url.searchParams.get("chrome")).toBe("none");
    expect(url.searchParams.get("app")).toBe("rocket-crew");
  });

  it("encodes the app id", () => {
    expect(castLauncherUrl("https://tv.example/?token=a", "a b&c")).toBe(
      "https://tv.example/?token=a&chrome=none&app=a%20b%26c",
    );
  });

  it("replaces an earlier chrome/app instead of repeating them", () => {
    const once = castLauncherUrl(launcher, "rocket-crew");
    const twice = castLauncherUrl(once, "night-flight");
    const url = new URL(twice);
    expect(url.searchParams.getAll("chrome")).toEqual(["none"]);
    expect(url.searchParams.getAll("app")).toEqual(["night-flight"]);
  });

  it("works on a launcher URL with no query", () => {
    expect(castLauncherUrl("https://tv.example/", "x")).toBe(
      "https://tv.example/?chrome=none&app=x",
    );
  });
});
