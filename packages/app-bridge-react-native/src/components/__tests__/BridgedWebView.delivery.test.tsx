/// <reference types="jest" />

import type { BridgeStores, NativeBridge, WebView } from "@open-game-system/app-bridge-types";
import { render } from "@testing-library/react-native";
import * as webviewModule from "react-native-webview";
import { BridgedWebView } from "../BridgedWebView";

// The page's web bridge listens on `window` for "message". react-native-webview's own postMessage
// fires it on `window` on iOS but on `document` on Android (no bubbling), where the page never
// hears it: every game in the Android app saw no profile, cast or session. So BridgedWebView
// delivers each bridge message itself, on `window`, the same on both platforms.

// The manual mock (src/__mocks__/react-native-webview.js) shares one set of ref methods.
type RefMethods = { postMessage: jest.Mock; injectJavaScript: jest.Mock };
const isRefMethods = (v: unknown): v is RefMethods =>
  typeof v === "object" && v !== null && "postMessage" in v && "injectJavaScript" in v;
const shared: unknown = Reflect.get(webviewModule, "mockWebViewRefMethods");
if (!isRefMethods(shared)) throw new Error("the react-native-webview mock has no ref methods");
const refMethods = shared;

function mount(): () => WebView | null | undefined {
  let registered: WebView | null | undefined;
  const bridge: NativeBridge<BridgeStores> = {
    isSupported: () => true,
    getStore: () => undefined,
    setStore: () => {},
    subscribe: () => () => {},
    handleWebMessage: () => {},
    registerWebView: (w) => {
      registered = w;
      return () => {};
    },
    unregisterWebView: () => {},
    subscribeToReadyState: () => () => {},
    getReadyState: () => false,
  };
  render(<BridgedWebView bridge={bridge} source={{ uri: "https://game.example/" }} />);
  return () => registered;
}

/** Runs an injected script in a page that has only `window` and `document`; what each heard. */
function runInPage(script: unknown) {
  const onWindow: unknown[] = [];
  const onDocument: unknown[] = [];
  class FakeMessageEvent {
    readonly data: unknown;
    constructor(
      readonly type: string,
      init: { data: unknown },
    ) {
      this.data = init.data;
    }
  }
  const window = { dispatchEvent: (e: FakeMessageEvent) => onWindow.push([e.type, e.data]) };
  const document = { dispatchEvent: (e: FakeMessageEvent) => onDocument.push([e.type, e.data]) };
  new Function("window", "document", "MessageEvent", String(script))(
    window,
    document,
    FakeMessageEvent,
  );
  return { onWindow, onDocument };
}

describe("BridgedWebView delivers bridge messages on window", () => {
  beforeEach(() => jest.clearAllMocks());

  it("registers a WebView whose postMessage fires a window message event in the page", () => {
    const registered = mount();
    const message = JSON.stringify({ type: "STATE_INIT", storeKey: "profile", data: { a: 1 } });
    registered()?.postMessage?.(message);
    expect(refMethods.injectJavaScript).toHaveBeenCalledTimes(1);
    expect(runInPage(refMethods.injectJavaScript.mock.calls[0]?.[0])).toEqual({
      onWindow: [["message", message]],
      onDocument: [],
    });
  });

  it("keeps any text intact: quotes, backslashes, newlines, </script>, line separators", () => {
    const registered = mount();
    const nasty = `{"s":"it's \\"x\\" \\\\ </script>\n  "}`;
    registered()?.postMessage?.(nasty);
    expect(runInPage(refMethods.injectJavaScript.mock.calls[0]?.[0]).onWindow).toEqual([
      ["message", nasty],
    ]);
  });

  it("never uses react-native-webview's own postMessage (Android fires that on document)", () => {
    const registered = mount();
    registered()?.postMessage?.("{}");
    expect(refMethods.postMessage).not.toHaveBeenCalled();
  });
});
