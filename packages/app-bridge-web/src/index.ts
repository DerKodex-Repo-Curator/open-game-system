import type {
  Bridge,
  BridgeStores,
  Event,
  Operation,
  Store,
} from "@open-game-system/app-bridge-types";
import { applyPatch } from "fast-json-patch";

export type { BridgeStores, State } from "@open-game-system/app-bridge-types";

/**
 * Message types for communication
 */
export type WebToNativeMessage =
  | { type: "EVENT"; storeKey: string; event: Event }
  | { type: "BRIDGE_READY" };

export type NativeToWebMessage<TStores extends BridgeStores = BridgeStores> =
  | {
      type: "STATE_INIT";
      storeKey: keyof TStores;
      data: TStores[keyof TStores]["state"];
    }
  | {
      type: "STATE_UPDATE";
      storeKey: keyof TStores;
      data?: TStores[keyof TStores]["state"];
      operations?: Operation[];
    };

export interface WebViewBridge {
  postMessage: (message: string) => void;
}

declare global {
  interface Window {
    ReactNativeWebView?: WebViewBridge;
  }
}

/**
 * Creates a web bridge instance for use in web applications
 * This implementation receives state from the native side through WebView messages
 *
 * @template TStores Store definitions for the bridge
 * @returns A Bridge instance
 */
export function createWebBridge<TStores extends BridgeStores>(): Bridge<TStores> {
  // Internal state storage
  const stateByStore = new Map<keyof TStores, TStores[keyof TStores]["state"]>();

  // Store instances by key
  const stores = new Map<
    keyof TStores,
    Store<TStores[keyof TStores]["state"], TStores[keyof TStores]["events"]>
  >();

  // Listeners for state changes by store key
  const stateListeners = new Map<
    keyof TStores,
    Set<(state: TStores[keyof TStores]["state"]) => void>
  >();

  // Listeners for store availability changes
  const storeListeners = new Set<() => void>();

  /**
   * Notify all listeners for a specific store's state changes
   */
  const notifyStateListeners = <K extends keyof TStores>(storeKey: K) => {
    const listeners = stateListeners.get(storeKey);
    if (listeners && stateByStore.has(storeKey)) {
      const state = stateByStore.get(storeKey);
      listeners.forEach((listener) => listener(state!));
    }
  };

  /**
   * Notify all listeners that a store's availability has changed
   */
  const notifyStoreListeners = () => {
    storeListeners.forEach((listener) => listener());
  };

  // Handle messages from native
  if (typeof window !== "undefined" && window.ReactNativeWebView) {
    // Send bridge ready message
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "BRIDGE_READY" }));

    const messageHandler = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as NativeToWebMessage;
        if (message.type === "STATE_INIT") {
          if (message.data === null) {
            // Remove state when receiving null data
            stateByStore.delete(message.storeKey as keyof TStores);
          } else {
            // Initialize state with full data
            stateByStore.set(message.storeKey as keyof TStores, message.data);
          }
          notifyStateListeners(message.storeKey as keyof TStores);
          notifyStoreListeners();
        } else if (message.type === "STATE_UPDATE") {
          //  // Log update handling
          if (message.data === null) {
            // Remove state when receiving null data
            stateByStore.delete(message.storeKey as keyof TStores);
            notifyStateListeners(message.storeKey as keyof TStores);
            notifyStoreListeners();
          } else if (message.operations) {
            // Apply patch operations
            const currentState = stateByStore.get(message.storeKey as keyof TStores);
            if (currentState) {
              const result = applyPatch(currentState, message.operations);
              stateByStore.set(message.storeKey as keyof TStores, result.newDocument);
              notifyStateListeners(message.storeKey as keyof TStores);
            }
          }
        }
      } catch {
        // Not the error itself: a JSON error quotes the message, which may carry a token.
        console.error("[Web Bridge] Could not handle a message from the app; ignored.");
      }
    };

    window.addEventListener("message", messageHandler);

    // Optional: Add cleanup function if the bridge instance can be destroyed
    // () => window.removeEventListener("message", messageHandler);
  } else {
    console.warn("[Web Bridge] ReactNativeWebView NOT detected.");
  }

  return {
    /**
     * Check if the bridge is supported
     * For web bridge, this checks if ReactNativeWebView is available
     */
    isSupported: () => typeof window !== "undefined" && !!window.ReactNativeWebView,

    /**
     * Get a store by its key
     * Returns undefined if the store doesn't exist
     */
    getStore: <K extends keyof TStores>(
      storeKey: K,
    ): Store<TStores[K]["state"], TStores[K]["events"]> | undefined => {
      // Only return a store if we have state for it
      if (!stateByStore.has(storeKey)) return undefined;

      // Return existing store instance if we have one
      let store = stores.get(storeKey) as
        | Store<TStores[K]["state"], TStores[K]["events"]>
        | undefined;

      // Create a new store if needed
      if (!store) {
        const storeImpl: Store<TStores[K]["state"], TStores[K]["events"]> = {
          getSnapshot: () => stateByStore.get(storeKey)!,
          subscribe: (listener: (state: TStores[K]["state"]) => void) => {
            if (!stateListeners.has(storeKey)) {
              stateListeners.set(storeKey, new Set());
            }
            const listeners = stateListeners.get(storeKey)!;
            listeners.add(listener);

            // Notify immediately with current state
            if (stateByStore.has(storeKey)) {
              listener(stateByStore.get(storeKey)!);
            }

            return () => {
              listeners.delete(listener);
            };
          },
          dispatch: async (event: TStores[K]["events"]): Promise<void> => {
            if (!window.ReactNativeWebView) {
              console.warn("[Web Bridge] Cannot dispatch events: ReactNativeWebView not available");
              return;
            }
            const message: WebToNativeMessage = {
              type: "EVENT",
              storeKey: storeKey as string,
              event,
            };
            window.ReactNativeWebView.postMessage(JSON.stringify(message));
          },
          reset: () => {
            // For web bridge, reset is a no-op since state is managed by native
            console.warn("[Web Bridge] Reset operation not supported in web bridge");
          },
          // Add 'on' method to satisfy the interface
          on: <EventType extends TStores[K]["events"]["type"]>(
            eventType: EventType,
            _listener: (
              event: Extract<TStores[K]["events"], { type: EventType }>,
              store: Store<TStores[K]["state"], TStores[K]["events"]>,
            ) => Promise<void> | void,
          ): (() => void) => {
            console.warn(
              `[Web Bridge] store.on("${eventType}", ...) was called, but listeners added on the web side are not executed. Add listeners on the native side or via the store's 'on' config.`,
            );
            // Return a no-op unsubscribe function
            return () => {};
          },
        };
        stores.set(storeKey, storeImpl);
        store = storeImpl;
      }

      return store;
    },

    /**
     * Set or remove a store for a given key
     */
    setStore: <K extends keyof TStores>(
      key: K,
      store: Store<TStores[K]["state"], TStores[K]["events"]> | undefined,
    ) => {
      if (store === undefined) {
        stores.delete(key);
        stateByStore.delete(key);
      } else {
        stores.set(key, store);
        const snapshot = store.getSnapshot();
        if (snapshot !== undefined) {
          stateByStore.set(key, snapshot);
        }
      }
      notifyStoreListeners();
    },

    /**
     * Subscribe to store availability changes
     * Returns an unsubscribe function
     */
    subscribe: (listener: () => void) => {
      storeListeners.add(listener);
      return () => {
        storeListeners.delete(listener);
      };
    },
  };
}
