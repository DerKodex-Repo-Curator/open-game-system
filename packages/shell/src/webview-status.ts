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

const retry = (s: WebViewStatus): WebViewStatus =>
  s.phase === "offline" ? { phase: "loading", attempt: s.attempt + 1 } : s;

const TRANSITIONS: Record<WebViewStatusEvent["type"], (s: WebViewStatus) => WebViewStatus> = {
  LOADED: (s) => (s.phase === "loading" ? { ...s, phase: "ready" } : s),
  FAILED: (s) => (s.phase === "offline" ? s : { ...s, phase: "offline" }),
  RETRY: retry,
  FOREGROUND: retry,
};

export function webViewStatus(state: WebViewStatus, event: WebViewStatusEvent): WebViewStatus {
  return TRANSITIONS[event.type](state);
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
