// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountNetworkBanner, qrDataUrl } from "../src/browser";
import type { SocketLike } from "../src/index";

const sockets = (behaviour: "open" | "error") =>
  class implements SocketLike {
    private readonly listeners = new Map<string, () => void>();
    constructor(public url: string) {
      setTimeout(() => this.listeners.get(behaviour)?.(), 1);
    }
    addEventListener(type: "open" | "error" | "close", listener: () => void) {
      this.listeners.set(type, listener);
    }
    close() {}
  };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountNetworkBanner: says so when this network blocks WebSockets", () => {
  it("blocked: an alert explains it and what to try", async () => {
    await mountNetworkBanner({ url: "wss://x/ws-probe", timeoutMs: 100, Socket: sockets("error") });
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Can't reach the game");
    expect(alert?.textContent).toContain("mobile data");
  });

  it("ok: nothing is shown", async () => {
    await mountNetworkBanner({ url: "wss://x/ws-probe", timeoutMs: 100, Socket: sockets("open") });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("takes the game's own words", async () => {
    await mountNetworkBanner({ url: "wss://x/ws-probe", timeoutMs: 100, Socket: sockets("error"), text: "The rocket can't reach mission control." });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("The rocket can't reach mission control.");
  });
});

describe("qrDataUrl", () => {
  it("draws a QR code of the link as an image data URL", () => {
    expect(qrDataUrl("https://x.dev/join/ABCD")).toMatch(/^data:image\/gif;base64,/);
  });
});
