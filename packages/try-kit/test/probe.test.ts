import { describe, expect, it } from "vitest";
import { probeWebSocket, type SocketLike } from "../src/index";

function fakeSocket(behaviour: "open" | "error" | "close" | "silent") {
  return class implements SocketLike {
    private readonly listeners = new Map<string, () => void>();
    closed = false;
    constructor(public url: string) {
      setTimeout(() => {
        if (behaviour !== "silent") this.listeners.get(behaviour)?.();
      }, 5);
    }
    addEventListener(type: "open" | "error" | "close", listener: () => void) {
      this.listeners.set(type, listener);
    }
    close() {
      this.closed = true;
    }
  };
}

describe("probeWebSocket: can this network reach the game's WebSockets?", () => {
  it("opens: ok", async () => {
    expect(await probeWebSocket("wss://x/ws-probe", 200, fakeSocket("open"))).toBe("ok");
  });
  it.each(["error", "close"] as const)("fails (%s) before opening: blocked", async (b) => {
    expect(await probeWebSocket("wss://x/ws-probe", 200, fakeSocket(b))).toBe("blocked");
  });
  it("never answers (a proxy holding it): blocked after the timeout", async () => {
    expect(await probeWebSocket("wss://x/ws-probe", 50, fakeSocket("silent"))).toBe("blocked");
  });
});
