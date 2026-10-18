import { subscribeHardwareBack } from "../hardware-back";

// Android's back button on the game screen does what the iOS edge swipe does: leave the game the
// OGS way (home on the TV when this phone runs it), never a bare pop of the screen.
function fakeBackHandler() {
  const listeners = new Set<() => boolean | null | undefined>();
  return {
    listeners,
    addEventListener(_event: "hardwareBackPress", fn: () => boolean | null | undefined) {
      listeners.add(fn);
      return { remove: () => void listeners.delete(fn) };
    },
    press: () => [...listeners].map((fn) => fn()),
  };
}

describe("Android's back button in a game", () => {
  it("leaves the game the OGS way and says it handled the press", () => {
    const back = fakeBackHandler();
    let left = 0;
    subscribeHardwareBack(back, () => left++);
    expect(back.press()).toEqual([true]);
    expect(left).toBe(1);
  });

  it("stops once the screen is gone", () => {
    const back = fakeBackHandler();
    const off = subscribeHardwareBack(back, () => {});
    off();
    expect(back.listeners.size).toBe(0);
  });
});
