import { _resetBridge, CAST_INITIAL_STATE, getCastBridge } from "@open-game-system/cast-kit-core";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CastButton, CastProvider } from "./index";

// 2026-10-18-shell-device-gaps.feature: in a white-label app (the OGS shell) the native cast store
// says casting is available with no Chromecast; the game's button opens the shell's picker.
function init(data: object) {
  getCastBridge();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({ type: "STATE_INIT", storeKey: "cast", data }),
    }),
  );
}

function Button() {
  return (
    <CastProvider>
      <CastButton>
        {({ deviceCount }, { showPicker }) => (
          <button type="button" onClick={showPicker}>
            Play on TV ({deviceCount})
          </button>
        )}
      </CastButton>
    </CastProvider>
  );
}

describe("CastButton in a white-label app", () => {
  const postMessage = vi.fn();
  beforeEach(() => {
    _resetBridge();
    postMessage.mockReset();
    vi.stubGlobal("ReactNativeWebView", { postMessage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows with no Chromecast when the app says casting is available, and opens its picker", () => {
    init({ ...CAST_INITIAL_STATE, isAvailable: true });
    const { getByText } = render(<Button />);
    const button = getByText("Play on TV (0)");
    act(() => {
      fireEvent.click(button);
    });
    const sent = postMessage.mock.calls.map(([m]) => JSON.parse(String(m)));
    expect(sent).toContainEqual({
      type: "EVENT",
      storeKey: "cast",
      event: { type: "SHOW_CAST_PICKER" },
    });
  });

  it("lists a browser TV like any other device", () => {
    init({
      ...CAST_INITIAL_STATE,
      isAvailable: true,
      devices: [{ id: "screen:sc1", name: "Browser TV", type: "browser" }],
    });
    const { getByText } = render(<Button />);
    expect(getByText("Play on TV (1)")).toBeTruthy();
  });

  it("stays hidden in the OGS app with no Chromecast (unchanged)", () => {
    init(CAST_INITIAL_STATE);
    const { queryByText } = render(<Button />);
    expect(queryByText(/Play on TV/)).toBeNull();
  });
});
