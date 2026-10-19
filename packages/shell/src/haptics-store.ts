import type { Store } from "@open-game-system/app-bridge-types";
import { type HapticsBridgeEvent, HapticsBridgeEventSchema } from "@open-game-system/ogs-protocol";
import type { UntrustedEvent } from "./ogs-bridge";

/** Plays a haptic (expo-haptics in the app, a fake in tests). */
export interface HapticsPlayer {
  impact(style: Extract<HapticsBridgeEvent, { type: "IMPACT" }>["style"]): Promise<void>;
  notify(kind: Extract<HapticsBridgeEvent, { type: "NOTIFY" }>["kind"]): Promise<void>;
}

export type HapticsBridgeState = Record<string, never>;
export type HapticsStores = { haptics: { state: HapticsBridgeState; events: UntrustedEvent } };

const EMPTY: HapticsBridgeState = {};

/** The `haptics` app-bridge store: IMPACT / NOTIFY from the page, played on the device. */
export function createHapticsStore(
  player: HapticsPlayer,
): Store<HapticsBridgeState, UntrustedEvent> {
  const warn = (err: unknown) => console.warn("[ogs-shell] haptics failed:", err);
  return {
    getSnapshot: () => EMPTY,
    subscribe(listener) {
      listener(EMPTY);
      return () => {};
    },
    reset: () => {},
    on: () => () => {},
    dispatch(event) {
      const parsed = HapticsBridgeEventSchema.safeParse(event);
      if (!parsed.success) return;
      const e = parsed.data;
      (e.type === "IMPACT" ? player.impact(e.style) : player.notify(e.kind)).catch(warn);
    },
  };
}
