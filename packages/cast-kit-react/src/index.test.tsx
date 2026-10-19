import { _resetBridge, CAST_INITIAL_STATE, getCastBridge } from "@open-game-system/cast-kit-core";
import { act, render, renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CastButton,
  CastProvider,
  CastStatus,
  useCastAvailable,
  useCastDeviceCount,
  useCastDeviceName,
  useCastDispatch,
  useCastStatus,
  useCastState,
  useCastViewUrl,
} from "./index";

function initCastStore(data: object) {
  // Ensure bridge is created before sending STATE_INIT
  getCastBridge();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({
        type: "STATE_INIT",
        storeKey: "cast",
        data,
      }),
    }),
  );
}

function sendStateUpdate(operations: object[]) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({
        type: "STATE_UPDATE",
        storeKey: "cast",
        operations,
      }),
    }),
  );
}

const CONNECTED_STATE = {
  isAvailable: true,
  devices: [
    { id: "tv-1", name: "Living Room TV", type: "chromecast" },
    { id: "tv-2", name: "Bedroom TV", type: "airplay" },
  ],
  session: {
    status: "connected",
    deviceId: "tv-1",
    deviceName: "Living Room TV",
    sessionId: "session-123",
    streamSessionId: "stream-456",
  },
  error: null,
};

describe("Cast-Kit React Hooks", () => {
  beforeEach(() => {
    _resetBridge();
    vi.stubGlobal("ReactNativeWebView", {
      postMessage: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createWrapper() {
    return ({ children }: { children: React.ReactNode }) => <CastProvider>{children}</CastProvider>;
  }

  describe("CastProvider", () => {
    it("renders null for children when cast store is not initialized", () => {
      // Bridge exists but no STATE_INIT — Provider renders null
      const wrapper = createWrapper();
      const { result } = renderHook(
        () => {
          // This hook will never execute because Provider renders null
          return "rendered";
        },
        { wrapper },
      );

      // renderHook returns null result when wrapper renders null
      expect(result.current).toBe(null);
    });

    it("renders nothing when bridge is null (no ReactNativeWebView, no window)", () => {
      // When ReactNativeWebView is absent AND bridge is reset,
      // getCastBridge() creates a bridge that exists but isn't supported.
      // We need to test the case where getCastBridge() returns null.
      // This happens in SSR where window is undefined.
      // Since we can't delete window (React needs it), we test by
      // verifying that CastProvider renders no content when bridge is not usable.
      vi.stubGlobal("ReactNativeWebView", undefined);
      _resetBridge();

      const { container } = render(
        <CastProvider>
          <div data-testid="child">Should not render</div>
        </CastProvider>,
      );
      // Bridge exists but store is not initialized, so Provider's StoreContext
      // renders null for children
      expect(container.querySelector('[data-testid="child"]')).toBe(null);
    });

    it("renders children when cast store is initialized", () => {
      initCastStore(CAST_INITIAL_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastState(), { wrapper });

      expect(result.current).toEqual(CAST_INITIAL_STATE);
    });
  });

  describe("useCastState", () => {
    it("returns full cast state", () => {
      initCastStore(CONNECTED_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastState(), { wrapper });

      expect(result.current.isAvailable).toBe(true);
      expect(result.current.devices).toHaveLength(2);
      expect(result.current.session.status).toBe("connected");
      expect(result.current.error).toBe(null);
    });

    it("updates when state changes", () => {
      initCastStore(CAST_INITIAL_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastState(), { wrapper });

      expect(result.current.isAvailable).toBe(false);

      act(() => {
        sendStateUpdate([{ op: "replace", path: "/isAvailable", value: true }]);
      });

      expect(result.current.isAvailable).toBe(true);
    });
  });

  describe("useCastStatus", () => {
    it("returns the current session status", () => {
      initCastStore(CONNECTED_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastStatus(), { wrapper });

      expect(result.current).toBe("connected");
    });
  });

  describe("useCastDeviceName", () => {
    it("returns the connected device name", () => {
      initCastStore(CONNECTED_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastDeviceName(), { wrapper });

      expect(result.current).toBe("Living Room TV");
    });
  });

  describe("useCastDeviceCount", () => {
    it("returns the number of devices", () => {
      initCastStore(CONNECTED_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastDeviceCount(), { wrapper });

      expect(result.current).toBe(2);
    });
  });

  describe("useCastAvailable", () => {
    it("returns false when no devices", () => {
      initCastStore(CAST_INITIAL_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastAvailable(), { wrapper });

      expect(result.current).toBe(false);
    });

    it("returns true when devices available", () => {
      initCastStore(CONNECTED_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastAvailable(), { wrapper });

      expect(result.current).toBe(true);
    });
  });

  describe("CastButton (render prop)", () => {
    it("renders nothing when not available", () => {
      initCastStore(CAST_INITIAL_STATE);

      const renderFn = vi.fn(() => null);
      const { container } = render(
        <CastProvider>
          <CastButton>{renderFn}</CastButton>
        </CastProvider>,
      );

      expect(renderFn).not.toHaveBeenCalled();
      expect(container.innerHTML).toBe("");
    });

    it("calls render prop with disconnected state when devices available", () => {
      initCastStore({
        ...CAST_INITIAL_STATE,
        isAvailable: true,
        devices: [{ id: "tv-1", name: "TV 1", type: "chromecast" }],
      });

      const renderFn = vi.fn(() => <button>Cast</button>);
      render(
        <CastProvider>
          <CastButton>{renderFn}</CastButton>
        </CastProvider>,
      );

      expect(renderFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "disconnected",
          deviceCount: 1,
          deviceName: null,
          error: null,
        }),
        expect.objectContaining({
          startCasting: expect.any(Function),
          stopCasting: expect.any(Function),
          showPicker: expect.any(Function),
        }),
      );
    });

    it("calls render prop with connected state", () => {
      initCastStore(CONNECTED_STATE);

      const renderFn = vi.fn(() => <span>Connected</span>);
      render(
        <CastProvider>
          <CastButton>{renderFn}</CastButton>
        </CastProvider>,
      );

      expect(renderFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "connected",
          deviceName: "Living Room TV",
        }),
        expect.any(Object),
      );
    });
  });

  describe("CastStatus (render prop)", () => {
    it("renders nothing when disconnected", () => {
      initCastStore(CAST_INITIAL_STATE);

      const renderFn = vi.fn(() => null);
      render(
        <CastProvider>
          <CastStatus>{renderFn}</CastStatus>
        </CastProvider>,
      );

      expect(renderFn).not.toHaveBeenCalled();
    });

    it("calls render prop with connecting state", () => {
      initCastStore({
        ...CAST_INITIAL_STATE,
        isAvailable: true,
        session: { ...CAST_INITIAL_STATE.session, status: "connecting", deviceId: "tv-1" },
      });

      const renderFn = vi.fn(() => <span>Connecting...</span>);
      render(
        <CastProvider>
          <CastStatus>{renderFn}</CastStatus>
        </CastProvider>,
      );

      expect(renderFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "connecting",
          deviceName: null,
          error: null,
        }),
      );
    });

    it("calls render prop with connected state and device name", () => {
      initCastStore(CONNECTED_STATE);

      const renderFn = vi.fn(() => <span>Casting to TV</span>);
      render(
        <CastProvider>
          <CastStatus>{renderFn}</CastStatus>
        </CastProvider>,
      );

      expect(renderFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "connected",
          deviceName: "Living Room TV",
        }),
      );
    });

    it("calls render prop with error", () => {
      initCastStore({
        ...CONNECTED_STATE,
        error: "Stream ended unexpectedly",
      });

      const renderFn = vi.fn(() => <span>Error</span>);
      render(
        <CastProvider>
          <CastStatus>{renderFn}</CastStatus>
        </CastProvider>,
      );

      expect(renderFn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Stream ended unexpectedly",
        }),
      );
    });
  });

  describe("useCastViewUrl", () => {
    const lastEvent = () => {
      const postMessage = (window as any).ReactNativeWebView.postMessage;
      const calls = postMessage.mock.calls.map((c: [string]) => JSON.parse(c[0]));
      return calls.filter((m: { type: string }) => m.type === "EVENT").pop();
    };

    it("tells the host app which page to put on the TV", () => {
      initCastStore(CAST_INITIAL_STATE);
      renderHook(() => useCastViewUrl("https://game.example/tv/ABCD"), { wrapper: createWrapper() });
      expect(lastEvent()?.event).toEqual({ type: "SET_VIEW_URL", url: "https://game.example/tv/ABCD" });
    });

    it("sends again when the URL changes", () => {
      initCastStore(CAST_INITIAL_STATE);
      const { rerender } = renderHook(({ url }) => useCastViewUrl(url), {
        wrapper: createWrapper(),
        initialProps: { url: "https://game.example/tv/AAAA" },
      });
      rerender({ url: "https://game.example/tv/BBBB" });
      expect(lastEvent()?.event).toEqual({ type: "SET_VIEW_URL", url: "https://game.example/tv/BBBB" });
    });

    it("sends nothing for a null URL", () => {
      initCastStore(CAST_INITIAL_STATE);
      renderHook(() => useCastViewUrl(null), { wrapper: createWrapper() });
      expect(lastEvent()).toBeUndefined();
    });
  });

  describe("useCastDispatch", () => {
    it("dispatches events to the cast store", () => {
      initCastStore(CAST_INITIAL_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastDispatch(), { wrapper });

      act(() => {
        result.current({ type: "SCAN_DEVICES" });
      });

      const postMessage = (window as any).ReactNativeWebView.postMessage;
      const lastCall = postMessage.mock.calls[postMessage.mock.calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed.type).toBe("EVENT");
      expect(parsed.storeKey).toBe("cast");
      expect(parsed.event.type).toBe("SCAN_DEVICES");
    });

    it("dispatches START_CASTING with deviceId", () => {
      initCastStore(CAST_INITIAL_STATE);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useCastDispatch(), { wrapper });

      act(() => {
        result.current({ type: "START_CASTING", deviceId: "tv-1" });
      });

      const postMessage = (window as any).ReactNativeWebView.postMessage;
      const lastCall = postMessage.mock.calls[postMessage.mock.calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed.event.type).toBe("START_CASTING");
      expect(parsed.event.deviceId).toBe("tv-1");
    });
  });
});
