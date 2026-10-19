import { castLauncherUrl } from "../cast-launcher-url";

describe("castLauncherUrl with a hash", () => {
  it("keeps the hash at the end, after the added parameters", () => {
    expect(castLauncherUrl("https://tv.test/?api=a&token=t#room", "rocket-crew")).toBe(
      "https://tv.test/?api=a&token=t&chrome=none&app=rocket-crew#room",
    );
  });

  it("a hash with a ? in it stays the hash", () => {
    expect(castLauncherUrl("https://tv.test/#a?b=c", "x")).toBe(
      "https://tv.test/?chrome=none&app=x#a?b=c",
    );
  });
});
