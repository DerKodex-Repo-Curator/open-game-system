import type { BridgeStores, State } from "@open-game-system/app-bridge-types";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createNativeBridge, createStore, type WebView } from "../index";

// The bridge carries the player's OGS token (the profile store). The app's console reaches the
// device log in release builds (Android logcat, iOS os_log), so the bridge never logs a store's
// state, a patch, an event or a raw message: only that something happened.
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJkYW5hIn0.c2lnbmF0dXJl";

interface ProfileState extends State {
  status: string;
  token: string;
}
type Stores = BridgeStores<{
  profile: { state: ProfileState; events: { type: "REFRESH"; token: string } };
}>;

const consoleMethods = ["log", "info", "debug", "warn", "error"] as const;
function capture() {
  const lines: string[] = [];
  for (const m of consoleMethods)
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  return lines;
}
afterEach(() => vi.restoreAllMocks());

function bridgeWithProfile() {
  const bridge = createNativeBridge<Stores>();
  const store = createStore<ProfileState, { type: "REFRESH"; token: string }>({
    initialState: { status: "ready", token: TOKEN },
    producer: (draft, event) => {
      draft.token = event.token;
    },
  });
  bridge.setStore("profile", store);
  const posted: string[] = [];
  const webView: WebView = { postMessage: (m) => posted.push(m) };
  return { bridge, store, webView, posted };
}

describe("the native bridge keeps tokens out of the logs", () => {
  test("registering, BRIDGE_READY, state updates and events log no state", () => {
    const lines = capture();
    const { bridge, webView, posted } = bridgeWithProfile();
    bridge.registerWebView(webView);
    bridge.handleWebMessage(JSON.stringify({ type: "BRIDGE_READY" }));
    bridge.handleWebMessage(
      JSON.stringify({
        type: "EVENT",
        storeKey: "profile",
        event: { type: "REFRESH", token: `${TOKEN}2` },
      }),
    );
    // The page still gets the token: only the logs leave it out.
    expect(posted.join("\n")).toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("eyJ");
    expect(lines.join("\n")).not.toContain('"token"');
  });

  test("a malformed message is reported without echoing it", () => {
    const lines = capture();
    const { bridge } = bridgeWithProfile();
    bridge.handleWebMessage(`{"token":"${TOKEN}"`);
    bridge.handleWebMessage(JSON.stringify({ token: TOKEN }));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("eyJ");
  });
});
