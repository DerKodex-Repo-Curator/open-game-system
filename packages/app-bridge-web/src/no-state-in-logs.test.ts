/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { type BridgeStores, createWebBridge, type State } from "./index";

// The page's console reaches the device log in the OGS app (Android's WebView writes it to
// logcat), and the profile store carries the player's OGS token. So the web bridge never logs a
// message, a state or an event: only that something happened.
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJkYW5hIn0.c2lnbmF0dXJl";

interface ProfileState extends State {
  status: string;
  token: string;
}
interface Stores extends BridgeStores {
  profile: { state: ProfileState; events: { type: "REFRESH"; token: string } };
}

const consoleMethods = ["log", "info", "debug", "warn", "error"] as const;
function capture() {
  const lines: string[] = [];
  for (const m of consoleMethods)
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((a) => {
            if (typeof a === "string") return a;
            if (a instanceof Event && "data" in a) return String(a.data);
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" "),
      );
    });
  return lines;
}

function installWebView(posted: string[]) {
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage: (m: string) => posted.push(m) },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "ReactNativeWebView");
});

const deliver = (data: string) => window.dispatchEvent(new MessageEvent("message", { data }));

describe("the web bridge keeps tokens out of the logs", () => {
  it("STATE_INIT, STATE_UPDATE and dispatched events log no state", () => {
    const lines = capture();
    const posted: string[] = [];
    installWebView(posted);
    const bridge = createWebBridge<Stores>();
    deliver(
      JSON.stringify({
        type: "STATE_INIT",
        storeKey: "profile",
        data: { status: "ready", token: TOKEN },
      }),
    );
    deliver(
      JSON.stringify({
        type: "STATE_UPDATE",
        storeKey: "profile",
        operations: [{ op: "replace", path: "/token", value: `${TOKEN}2` }],
      }),
    );
    bridge.getStore("profile")?.dispatch({ type: "REFRESH", token: TOKEN });
    // The game still gets the token: only the logs leave it out.
    expect(bridge.getStore("profile")?.getSnapshot().token).toBe(`${TOKEN}2`);
    expect(posted.join("\n")).toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("eyJ");
  });

  it("a message it can't read is reported without echoing it", () => {
    const lines = capture();
    installWebView([]);
    createWebBridge<Stores>();
    deliver(`{"token":"${TOKEN}"`);
    expect(lines.join("\n")).not.toContain("eyJ");
  });
});
