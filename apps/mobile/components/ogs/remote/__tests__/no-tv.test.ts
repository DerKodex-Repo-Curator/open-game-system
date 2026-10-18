import { noTvCauses } from "../no-tv";

// "No TV found" lists the likely causes. iOS's Local Network switch doesn't exist on Android.
describe("why no Chromecast shows up", () => {
  it("on iPhone: Local Network first, then Wi-Fi, then a sleeping TV", () => {
    expect(noTvCauses("ios").map(([title]) => title)).toEqual([
      "Local Network is off for OGS",
      "Different Wi-Fi",
      "The TV is asleep",
    ]);
  });

  it("on Android: no Local Network switch to send anyone to", () => {
    expect(noTvCauses("android").map(([title]) => title)).toEqual([
      "Different Wi-Fi",
      "The TV is asleep",
    ]);
  });
});
