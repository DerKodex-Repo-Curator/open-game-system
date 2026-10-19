import { createCastPicker } from "../cast-picker";
import type { CastDevice } from "../cast-store";
import type { AddScreenResult } from "../screen-cast";

const TV: CastDevice = { id: "tv-1", name: "Living Room TV", type: "chromecast" };
const SCREEN: CastDevice = { id: "screen:s1", name: "Browser TV", type: "browser" };

function targets(over: { addBrowserTv?: (code: string) => Promise<AddScreenResult> } = {}) {
  let devices: CastDevice[] = [TV];
  const listeners = new Set<(d: CastDevice[]) => void>();
  const t = {
    getDevices: () => devices,
    subscribeDevices: (l: (d: CastDevice[]) => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    cast: jest.fn(),
    addBrowserTv: over.addBrowserTv ?? jest.fn(async () => ({ ok: true as const, device: SCREEN })),
    tvAddress: "ogs-tv.pages.dev",
  };
  const setDevices = (next: CastDevice[]) => {
    devices = next;
    for (const l of listeners) l(next);
  };
  return { t, setDevices, listeners };
}

describe("createCastPicker", () => {
  it("starts closed, with no devices and no browser TV until a cast store attaches", () => {
    const picker = createCastPicker();
    expect(picker.getSnapshot()).toEqual({ visible: false, devices: [], browserTv: null });
  });

  it("lists the attached devices as they change, and offers a browser TV", () => {
    const picker = createCastPicker();
    const { t, setDevices } = targets();
    picker.attach(t);
    expect(picker.getSnapshot().devices).toEqual([TV]);
    expect(picker.getSnapshot().browserTv).toEqual({
      open: false,
      address: "ogs-tv.pages.dev",
      pairing: false,
      error: null,
    });
    const seen = jest.fn();
    picker.subscribe(seen);
    setDevices([TV, SCREEN]);
    expect(picker.getSnapshot().devices).toEqual([TV, SCREEN]);
    expect(seen).toHaveBeenCalled();
  });

  it("opens and closes; picking a TV casts to it and closes", () => {
    const picker = createCastPicker();
    const { t } = targets();
    picker.attach(t);
    picker.open();
    expect(picker.getSnapshot().visible).toBe(true);
    picker.pick(TV.id);
    expect(t.cast).toHaveBeenCalledWith(TV.id);
    expect(picker.getSnapshot().visible).toBe(false);
  });

  it("pairs a browser TV by its code, then casts to it and closes", async () => {
    const picker = createCastPicker();
    const { t } = targets();
    picker.attach(t);
    picker.open();
    picker.openBrowserTv();
    expect(picker.getSnapshot().browserTv?.open).toBe(true);
    const pairing = picker.pairBrowserTv(" kqtp7x ");
    expect(picker.getSnapshot().browserTv?.pairing).toBe(true);
    await pairing;
    expect(t.addBrowserTv).toHaveBeenCalledWith("KQTP7X");
    expect(t.cast).toHaveBeenCalledWith(SCREEN.id);
    expect(picker.getSnapshot()).toMatchObject({
      visible: false,
      browserTv: { open: false, pairing: false, error: null },
    });
  });

  it("a wrong code says so and stays open; closing clears it", async () => {
    const picker = createCastPicker();
    const { t } = targets({
      addBrowserTv: async () => ({
        ok: false,
        message: "No TV shows that code. Check the code on the TV.",
      }),
    });
    picker.attach(t);
    picker.open();
    picker.openBrowserTv();
    await picker.pairBrowserTv("AAAAAA");
    expect(t.cast).not.toHaveBeenCalled();
    expect(picker.getSnapshot()).toMatchObject({
      visible: true,
      browserTv: {
        open: true,
        pairing: false,
        error: "No TV shows that code. Check the code on the TV.",
      },
    });
    picker.close();
    expect(picker.getSnapshot()).toMatchObject({
      visible: false,
      browserTv: { open: false, error: null },
    });
  });

  it("pairs once at a time", async () => {
    let finish: (r: AddScreenResult) => void = () => {};
    const add = jest.fn(
      () =>
        new Promise<AddScreenResult>((r) => {
          finish = r;
        }),
    );
    const picker = createCastPicker();
    picker.attach(targets({ addBrowserTv: add }).t);
    const first = picker.pairBrowserTv("AAAAAA");
    await picker.pairBrowserTv("AAAAAA");
    expect(add).toHaveBeenCalledTimes(1);
    finish({ ok: true, device: SCREEN });
    await first;
  });

  it("detaching stops following the devices", () => {
    const picker = createCastPicker();
    const { t, listeners } = targets();
    const detach = picker.attach(t);
    detach();
    expect(listeners.size).toBe(0);
    expect(picker.getSnapshot()).toEqual({ visible: false, devices: [], browserTv: null });
  });

  it("without a browser TV target, only the devices are offered", () => {
    const picker = createCastPicker();
    const { t } = targets();
    picker.attach({ ...t, addBrowserTv: undefined });
    expect(picker.getSnapshot().browserTv).toBeNull();
  });
});
