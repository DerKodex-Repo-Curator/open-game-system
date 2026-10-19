import type { CastDevice } from "./cast-store";
import type { AddScreenResult } from "./screen-cast";

/**
 * The single-game app's TV picker (the game's cast button opens it through SHOW_CAST_PICKER):
 * every Chromecast found and the phone's paired browser TVs, plus "Use a browser TV" (the TV's
 * browser opens the OGS TV launcher and shows a code; the phone types it, as in the OGS app).
 * React-free; CastPickerSheet renders it.
 */
export interface CastPickerTargets {
  getDevices(): CastDevice[];
  subscribeDevices(listener: (devices: CastDevice[]) => void): () => void;
  /** Cast to this TV (the game's cast store: START_CASTING). */
  cast(deviceId: string): void;
  /** Pair a browser TV by the code it shows; left out, no browser TV is offered. */
  addBrowserTv?: (code: string) => Promise<AddScreenResult>;
  /** Where the TV's browser goes, e.g. "ogs-tv.pages.dev". */
  tvAddress: string;
}

export interface BrowserTvState {
  /** The pairing panel is showing (else only its "Use a browser TV" button). */
  open: boolean;
  address: string;
  pairing: boolean;
  error: string | null;
}

export interface CastPickerState {
  visible: boolean;
  devices: CastDevice[];
  /** null: this app offers no browser TV. */
  browserTv: BrowserTvState | null;
}

const CLOSED: CastPickerState = { visible: false, devices: [], browserTv: null };

export function createCastPicker() {
  let state: CastPickerState = CLOSED;
  let targets: CastPickerTargets | null = null;
  const listeners = new Set<() => void>();
  const set = (next: CastPickerState) => {
    state = next;
    for (const l of listeners) l();
  };
  const setBrowserTv = (patch: Partial<BrowserTvState>) => {
    if (state.browserTv) set({ ...state, browserTv: { ...state.browserTv, ...patch } });
  };
  const closed = (): CastPickerState => ({
    ...state,
    visible: false,
    browserTv: state.browserTv
      ? { ...state.browserTv, open: false, pairing: false, error: null }
      : null,
  });
  /** Casts to a TV (if the cast store is still attached) and closes the picker. */
  const castTo = (deviceId: string) => {
    targets?.cast(deviceId);
    set(closed());
  };

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The cast store's TVs and actions. Returns the detach. */
    attach(next: CastPickerTargets): () => void {
      targets = next;
      set({
        ...state,
        devices: next.getDevices(),
        browserTv: next.addBrowserTv
          ? { open: false, address: next.tvAddress, pairing: false, error: null }
          : null,
      });
      const off = next.subscribeDevices((devices) => set({ ...state, devices }));
      return () => {
        off();
        if (targets !== next) return;
        targets = null;
        set(CLOSED);
      };
    },
    open: () => set({ ...state, visible: true }),
    close: () => set(closed()),
    pick: castTo,
    openBrowserTv: () => setBrowserTv({ open: true, error: null }),
    /** The code the browser TV shows: pair it, then cast to it. */
    async pairBrowserTv(code: string): Promise<void> {
      const add = targets?.addBrowserTv;
      // Stryker disable next-line OptionalChaining: equivalent, attach sets browserTv whenever the targets offer addBrowserTv
      if (!add || state.browserTv?.pairing) return;
      setBrowserTv({ pairing: true, error: null });
      const result = await add(code.trim().toUpperCase());
      if (!result.ok) return setBrowserTv({ pairing: false, error: result.message });
      castTo(result.device.id);
    },
  };
}

export type CastPicker = ReturnType<typeof createCastPicker>;
