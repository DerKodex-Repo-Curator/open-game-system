import GoogleCast from "react-native-google-cast";
import { createCastStore } from "../cast-store";

jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

const TV = { id: "tv-1", name: "Living Room TV", type: "chromecast" as const };

afterEach(() => jest.clearAllMocks());

describe("createCastStore without options (the OGS app)", () => {
  it("is available only while a Chromecast is found, and the picker is Google Cast's", () => {
    const store = createCastStore();
    expect(store.getSnapshot().isAvailable).toBe(false);
    store.dispatch({ type: "DEVICES_UPDATED", devices: [TV] });
    expect(store.getSnapshot().isAvailable).toBe(true);
    store.dispatch({ type: "DEVICES_UPDATED", devices: [] });
    expect(store.getSnapshot().isAvailable).toBe(false);
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    expect(GoogleCast.showCastDialog).toHaveBeenCalledTimes(1);
  });
});

describe("createCastStore for a single-game app (alwaysAvailable, its own picker)", () => {
  it("is available with no Chromecast: a browser TV is always a target", () => {
    const store = createCastStore(undefined, { alwaysAvailable: true });
    expect(store.getSnapshot().isAvailable).toBe(true);
    store.dispatch({ type: "DEVICES_UPDATED", devices: [TV] });
    store.dispatch({ type: "DEVICES_UPDATED", devices: [] });
    expect(store.getSnapshot().isAvailable).toBe(true);
    expect(store.getSnapshot().devices).toEqual([]);
    store.reset();
    expect(store.getSnapshot().isAvailable).toBe(true);
  });

  it("SHOW_CAST_PICKER opens the given picker, not Google Cast's dialog", () => {
    const showPicker = jest.fn();
    const store = createCastStore(undefined, { showPicker });
    store.dispatch({ type: "SHOW_CAST_PICKER" });
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(GoogleCast.showCastDialog).not.toHaveBeenCalled();
  });
});
