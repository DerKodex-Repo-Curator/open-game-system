// @vitest-environment jsdom
import { createWebBridge } from "@open-game-system/app-bridge-web";
import { createOgsNotifications, createProfileSource } from "@open-game-system/profile-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeScript, injectBridge, type PhoneBridge } from "./bridge-script";

const player = {
  id: "dev-1",
  handle: "ada",
  name: "Ada",
  avatar: "https://example.com/a.png",
};
const bridgeCfg: PhoneBridge = {
  phone: 1,
  stores: {
    profile: { status: "ready", profile: { ...player, token: "tok" } },
    ogs: { reported: [] },
    notifications: { answer: null, last: null },
    cast: {
      isAvailable: true,
      devices: [],
      session: {
        status: "connected",
        deviceId: "tv",
        deviceName: "TV",
        sessionId: "s",
        streamSessionId: null,
      },
      error: null,
      viewUrl: null,
    },
  },
  pushHandle: "ph_devabcdefghijklmnop",
};

/** Runs the injected script the way the browser does (it is the page's first script). */
function inject(cfg: PhoneBridge) {
  const js = bridgeScript(cfg)
    .replace(/^<script[^>]*>/, "")
    .replace(/<\/script>$/, "");
  // jsdom doesn't run <script> elements; the script only touches window, so a Function is the same.
  new Function(js)();
}

afterEach(() => {
  delete window.ReactNativeWebView;
});

describe("the fake app bridge in a phone page", { timeout: 20_000 }, () => {
  it("is what profile-kit reads as the OGS profile (createWebBridge + createProfileSource)", async () => {
    inject(bridgeCfg);
    const source = createProfileSource({ bridge: createWebBridge(), timeoutMs: 5000 });
    const seen = new Promise((resolve) => {
      const off = source.subscribe(() => {
        const snap = source.getSnapshot();
        if (snap) {
          off();
          resolve(snap);
        }
      });
    });
    expect(await seen).toEqual({ ...player, token: "tok" });
  });

  it("grants notifications with a push handle when the game asks", async () => {
    inject(bridgeCfg);
    const notes = createOgsNotifications({ bridge: createWebBridge(), serviceWorker: undefined });
    await new Promise((r) => setTimeout(r, 20));
    expect(await notes.request()).toEqual({ status: "granted", handle: "ph_devabcdefghijklmnop" });
  });

  it("tells the harness what the game sent the app", () => {
    const parentPost = vi.fn();
    const parent = { postMessage: parentPost };
    Object.defineProperty(window, "parent", { value: parent, configurable: true });
    try {
      inject(bridgeCfg);
      window.ReactNativeWebView?.postMessage(
        JSON.stringify({
          type: "EVENT",
          storeKey: "cast",
          event: { type: "SET_VIEW_URL", url: "http://localhost:5173/tv/ROOM" },
        }),
      );
      expect(parentPost).toHaveBeenCalledWith(
        {
          type: "ogs-dev:bridge",
          phone: 1,
          message: {
            type: "EVENT",
            storeKey: "cast",
            event: { type: "SET_VIEW_URL", url: "http://localhost:5173/tv/ROOM" },
          },
        },
        "*",
      );
    } finally {
      Object.defineProperty(window, "parent", { value: window, configurable: true });
    }
  });

  it("can't be broken out of by a name with </script> in it", () => {
    const evil = {
      ...bridgeCfg,
      stores: {
        ...bridgeCfg.stores,
        profile: {
          status: "ready" as const,
          profile: { ...player, name: "</script><script>alert(1)</script>", token: "t" },
        },
      },
    };
    expect(bridgeScript(evil).match(/<\/script>/g)).toHaveLength(1);
  });
});

describe("injectBridge", () => {
  const s = "<script>B</script>";
  it("goes first in <head>, keeping its attributes", () => {
    expect(injectBridge('<html><head lang="x"><script>G</script></head></html>', s)).toBe(
      '<html><head lang="x"><script>B</script><script>G</script></head></html>',
    );
  });
  it("goes after <html> with no head, after the doctype with neither, else first", () => {
    expect(injectBridge("<html><body></body></html>", s)).toBe(
      "<html><script>B</script><body></body></html>",
    );
    expect(injectBridge("<!doctype html><p>x", s)).toBe("<!doctype html><script>B</script><p>x");
    expect(injectBridge("<p>x", s)).toBe("<script>B</script><p>x");
  });
  it("does not mistake <header> for <head>", () => {
    expect(injectBridge("<html><header></header></html>", s)).toBe(
      "<html><script>B</script><header></header></html>",
    );
  });
});
