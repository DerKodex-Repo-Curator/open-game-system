import { describe, expect, it } from "vitest";
import { phonePlan, tvJoinUi } from "./ogs-plan";

const profile = { id: "u1", handle: "sam", name: "Sam", avatar: "https://x/a.png", token: "t" };

describe("the TV's join UI", () => {
  it("waits (shows no code) until it knows whether the OGS launcher framed it", () => {
    expect(tvJoinUi(undefined)).toBe("wait");
  });
  it("keeps its own room code and QR in a plain browser", () => {
    expect(tvJoinUi(null)).toBe("own");
  });
  it("hides every code and QR on the OGS TV: OGS draws its own TV code", () => {
    expect(tvJoinUi({ instanceId: "i", mode: "new", token: "", players: [] })).toBe("ogs");
  });
});

describe("the phone's plan", () => {
  it("waits while the app is still answering who is playing", () => {
    expect(phonePlan({ profile: undefined, ogsRoom: null, urlRoom: null, inOgs: true })).toEqual({
      kind: "wait",
    });
  });
  it("hosts inside OGS: makes the room and declares the TV page, joins under the OGS profile", () => {
    expect(phonePlan({ profile, ogsRoom: null, urlRoom: null, inOgs: true })).toEqual({
      kind: "go",
      room: { make: true },
      join: { token: "t" },
    });
  });
  it("follows the TV into its room when OGS opens the page with ogsRoom", () => {
    expect(phonePlan({ profile, ogsRoom: "ABCD", urlRoom: null, inOgs: true })).toEqual({
      kind: "go",
      room: { code: "ABCD" },
      join: { token: "t" },
    });
  });
  it("in a plain browser asks for a name, and the code unless the link carried one", () => {
    expect(phonePlan({ profile: null, ogsRoom: null, urlRoom: "WXYZ", inOgs: false })).toEqual({
      kind: "form",
      code: "WXYZ",
    });
    expect(phonePlan({ profile: null, ogsRoom: null, urlRoom: null, inOgs: false })).toEqual({
      kind: "form",
      code: null,
    });
  });
});
