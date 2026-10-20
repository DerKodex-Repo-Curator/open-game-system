import { createCastPicker } from "../cast-picker";
import type { CastDevice } from "../cast-store";
import type { AddScreenResult } from "../screen-cast";

const TV: CastDevice = { id: "tv-1", name: "Living Room TV", type: "chromecast" };

function targets(withBrowserTv: boolean) {
  return {
    getDevices: () => [TV],
    subscribeDevices: () => () => {},
    cast: jest.fn(),
    ...(withBrowserTv
      ? {
          addBrowserTv: jest.fn(
            async (): Promise<AddScreenResult> => ({ ok: false, message: "no" }),
          ),
        }
      : {}),
    tvAddress: "ogs-tv.pages.dev",
  };
}

describe("createCastPicker, edges", () => {
  it("offers no browser TV when the cast store has none, even if asked to open it", () => {
    const picker = createCastPicker();
    picker.attach(targets(false));
    picker.openBrowserTv();
    expect(picker.getSnapshot().browserTv).toBeNull();
  });

  it("an unsubscribed listener hears nothing more", () => {
    const picker = createCastPicker();
    const heard = jest.fn();
    const off = picker.subscribe(heard);
    picker.open();
    off();
    picker.close();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("an earlier cast store's detach leaves the newer one attached", () => {
    const picker = createCastPicker();
    const first = targets(true);
    const second = targets(true);
    const detachFirst = picker.attach(first);
    picker.attach(second);
    picker.open();
    detachFirst();
    expect(picker.getSnapshot().visible).toBe(true);
    expect(picker.getSnapshot().devices).toEqual([TV]);
    picker.pick(TV.id);
    expect(second.cast).toHaveBeenCalledWith(TV.id);
    expect(first.cast).not.toHaveBeenCalled();
  });

  it("with nothing attached, picking or pairing does nothing (and doesn't throw)", async () => {
    const picker = createCastPicker();
    expect(() => picker.pick(TV.id)).not.toThrow();
    await expect(picker.pairBrowserTv("ABC123")).resolves.toBeUndefined();
    expect(picker.getSnapshot()).toEqual({ visible: false, devices: [], browserTv: null });
  });

  it("a TV paired after the cast store detached closes the picker without casting", async () => {
    const picker = createCastPicker();
    let pair: (r: { ok: true; device: CastDevice }) => void = () => {};
    const t = {
      ...targets(true),
      addBrowserTv: () =>
        new Promise<{ ok: true; device: CastDevice }>((resolve) => {
          pair = resolve;
        }),
    };
    const detach = picker.attach(t);
    picker.open();
    const pairing = picker.pairBrowserTv("abc123");
    detach();
    pair({ ok: true, device: { id: "screen:s1", name: "Browser TV", type: "browser" } });
    await expect(pairing).resolves.toBeUndefined();
    expect(t.cast).not.toHaveBeenCalled();
  });
});
