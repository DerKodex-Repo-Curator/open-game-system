/**
 * Simple observable store for the current game URL to load in the WebView.
 * Used to communicate between the root layout (which receives deep links
 * and notification taps) and the index screen (which owns the WebView).
 */

type Listener = (url: string) => void;

let listeners: Listener[] = [];
let pendingUrl: string | null = null;

/**
 * Set a game URL to be loaded in the WebView.
 */
export function setGameUrl(url: string): void {
  console.log("[GameUrlStore] Setting game URL:", url);
  pendingUrl = url;
  listeners.forEach((listener) => listener(url));
}

/**
 * Get and clear the pending game URL (if any).
 * Used on initial mount to check if the app was launched with a URL.
 */
export function consumePendingGameUrl(): string | null {
  const url = pendingUrl;
  pendingUrl = null;
  return url;
}

/**
 * Subscribe to game URL changes.
 * Returns an unsubscribe function.
 */
export function subscribeToGameUrl(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
