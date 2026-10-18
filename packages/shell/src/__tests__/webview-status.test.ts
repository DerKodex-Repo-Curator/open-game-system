import {
  INITIAL_WEBVIEW_STATUS,
  type WebViewStatus,
  watchForeground,
  webViewStatus,
} from "../webview-status";

const run = (...events: Parameters<typeof webViewStatus>[1][]): WebViewStatus =>
  events.reduce(webViewStatus, INITIAL_WEBVIEW_STATUS);

describe("webViewStatus", () => {
  it("starts loading, attempt 0", () => {
    expect(INITIAL_WEBVIEW_STATUS).toEqual({ phase: "loading", attempt: 0 });
  });

  it("is ready once the page loads", () => {
    expect(run({ type: "LOADED" })).toEqual({ phase: "ready", attempt: 0 });
  });

  it("is offline when the page fails to load, from loading or ready", () => {
    expect(run({ type: "FAILED" })).toEqual({ phase: "offline", attempt: 0 });
    expect(run({ type: "LOADED" }, { type: "FAILED" })).toEqual({ phase: "offline", attempt: 0 });
  });

  it("stays offline when a load-end arrives after the failure", () => {
    expect(run({ type: "FAILED" }, { type: "LOADED" })).toEqual({ phase: "offline", attempt: 0 });
  });

  it("retry from offline loads again with a new attempt", () => {
    expect(run({ type: "FAILED" }, { type: "RETRY" })).toEqual({ phase: "loading", attempt: 1 });
    expect(run({ type: "FAILED" }, { type: "RETRY" }, { type: "LOADED" })).toEqual({
      phase: "ready",
      attempt: 1,
    });
    expect(
      run({ type: "FAILED" }, { type: "RETRY" }, { type: "FAILED" }, { type: "RETRY" }),
    ).toEqual({ phase: "loading", attempt: 2 });
  });

  it("retry does nothing while loading or ready", () => {
    expect(run({ type: "RETRY" })).toBe(INITIAL_WEBVIEW_STATUS);
    const ready = run({ type: "LOADED" });
    expect(webViewStatus(ready, { type: "RETRY" })).toBe(ready);
  });

  it("coming back to the foreground retries only when offline", () => {
    expect(run({ type: "FAILED" }, { type: "FOREGROUND" })).toEqual({
      phase: "loading",
      attempt: 1,
    });
    const ready = run({ type: "LOADED" });
    expect(webViewStatus(ready, { type: "FOREGROUND" })).toBe(ready);
    expect(webViewStatus(INITIAL_WEBVIEW_STATUS, { type: "FOREGROUND" })).toBe(
      INITIAL_WEBVIEW_STATUS,
    );
  });
});

function fakeAppState(initial: string) {
  const listeners = new Set<(s: string) => void>();
  let removed = 0;
  return {
    currentState: initial,
    addEventListener(_type: "change", fn: (s: string) => void) {
      listeners.add(fn);
      return {
        remove: () => {
          removed += 1;
          listeners.delete(fn);
        },
      };
    },
    emit(s: string) {
      this.currentState = s;
      for (const l of listeners) l(s);
    },
    removed: () => removed,
  };
}

describe("watchForeground", () => {
  it("calls back when the app returns to active from the background or inactive", () => {
    const appState = fakeAppState("active");
    const onForeground = jest.fn();
    watchForeground(appState, onForeground);
    appState.emit("active");
    expect(onForeground).not.toHaveBeenCalled();
    appState.emit("background");
    appState.emit("active");
    expect(onForeground).toHaveBeenCalledTimes(1);
    appState.emit("inactive");
    appState.emit("active");
    expect(onForeground).toHaveBeenCalledTimes(2);
  });

  it("counts an app that starts in the background", () => {
    const appState = fakeAppState("background");
    const onForeground = jest.fn();
    watchForeground(appState, onForeground);
    appState.emit("active");
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it("stops listening when unsubscribed", () => {
    const appState = fakeAppState("active");
    const onForeground = jest.fn();
    const stop = watchForeground(appState, onForeground);
    stop();
    expect(appState.removed()).toBe(1);
    appState.emit("background");
    appState.emit("active");
    expect(onForeground).not.toHaveBeenCalled();
  });
});
