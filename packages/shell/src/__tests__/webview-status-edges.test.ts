import {
  type AppStateLike,
  type WebViewStatus,
  watchForeground,
  webViewStatus,
} from "../webview-status";

describe("webViewStatus, edges", () => {
  it("a failure while offline keeps the same state object", () => {
    const offline: WebViewStatus = { phase: "offline", attempt: 2 };
    expect(webViewStatus(offline, { type: "FAILED" })).toBe(offline);
  });
});

describe("watchForeground, edges", () => {
  function appState(current: string) {
    const events: string[] = [];
    let listener: (s: string) => void = () => {};
    const state: AppStateLike = {
      currentState: current,
      addEventListener: (type, l) => {
        events.push(type);
        listener = l;
        return { remove: () => {} };
      },
    };
    return { state, events, change: (s: string) => listener(s) };
  }

  it("listens to AppState's change event", () => {
    const { state, events } = appState("active");
    watchForeground(state, () => {});
    expect(events).toEqual(["change"]);
  });

  it("only becoming active counts, not going from background to inactive", () => {
    const { state, change } = appState("background");
    const onForeground = jest.fn();
    watchForeground(state, onForeground);
    change("inactive");
    expect(onForeground).not.toHaveBeenCalled();
    change("active");
    expect(onForeground).toHaveBeenCalledTimes(1);
  });
});
