import type { Outbound } from "@open-game-system/ogs-protocol";
import { initialSession } from "@open-game-system/ogs-protocol";
import { describe, expect, it } from "vitest";
import { recipients } from "../src/couch/route";

const peers = [
  { deviceId: "phone-1", kind: "phone" as const },
  { deviceId: "tv-1", kind: "launcher" as const },
  { deviceId: "ipad-1", kind: "tablet" as const },
  { deviceId: "phone-1", kind: "phone" as const },
];

describe("couch outbound routing", () => {
  it("sends state to every socket", () => {
    const out: Outbound = {
      to: "all",
      msg: { type: "state", state: initialSession("s-1", "host") },
    };
    expect(recipients(out, peers)).toEqual([0, 1, 2, 3]);
  });

  it("sends launcher messages to launcher sockets only", () => {
    const out: Outbound = { to: "launcher", msg: { type: "focus.move", dir: "right" } };
    expect(recipients(out, peers)).toEqual([1]);
  });

  it("sends device messages to every socket of that device", () => {
    const out: Outbound = {
      to: { deviceId: "phone-1" },
      msg: { type: "remote.offer", from: "phone-2" },
    };
    expect(recipients(out, peers)).toEqual([0, 3]);
  });

  it("sends nothing when the device is not connected", () => {
    const out: Outbound = {
      to: { deviceId: "gone" },
      msg: { type: "follow", target: { kind: "launcher" } },
    };
    expect(recipients(out, peers)).toEqual([]);
  });
});
