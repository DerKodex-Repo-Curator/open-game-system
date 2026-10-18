/**
 * The game WebView's status: `loading` until the page loads, `ready`, or `offline` when the page
 * could not load (the shell then shows its native OfflineScreen). Retry, by hand or when the app
 * returns to the foreground while offline, loads again with a new `attempt` (the WebView's key).
 */
export interface WebViewStatus {
  phase: "loading" | "ready" | "offline";
  attempt: number;
}

export type WebViewStatusEvent =
  | { type: "LOADED" }
  | { type: "FAILED" }
  | { type: "RETRY" }
  | { type: "FOREGROUND" };

export const INITIAL_WEBVIEW_STATUS: WebViewStatus = { phase: "loading", attempt: 0 };

export function webViewStatus(state: WebViewStatus, event: WebViewStatusEvent): WebViewStatus {
  switch (event.type) {
    case "LOADED":
      return state.phase === "loading" ? { ...state, phase: "ready" } : state;
    case "FAILED":
      return state.phase === "offline" ? state : { ...state, phase: "offline" };
    case "RETRY":
    case "FOREGROUND":
      return state.phase === "offline" ? { phase: "loading", attempt: state.attempt + 1 } : state;
  }
}

/** The slice of React Native's AppState this needs. */
export interface AppStateLike {
  currentState: string;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
}

/** Calls `onForeground` each time the app becomes active after being in the background/inactive. */
export function watchForeground(appState: AppStateLike, onForeground: () => void): () => void {
  let last = appState.currentState;
  const sub = appState.addEventListener("change", (next) => {
    if (next === "active" && last !== "active") onForeground();
    last = next;
  });
  return () => sub.remove();
}
