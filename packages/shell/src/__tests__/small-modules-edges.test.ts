import type { Store } from "@open-game-system/app-bridge-types";
import type { ProfileBridgeState } from "@open-game-system/ogs-protocol";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { tvAddress } from "../cast-stores";
import { createDeviceSource, DEVICE_ID_KEY } from "../device";
import type { ProfileEvents } from "../game-profile";
import { createHapticsStore } from "../haptics-store";
import { profileWithLogin } from "../profile-login";

describe("device id storage", () => {
  it("keeps the id under ogs.deviceId (devices already have it stored there)", async () => {
    const { storage } = fakeStorage();
    expect(DEVICE_ID_KEY).toBe("ogs.deviceId");
    const device = createDeviceSource({
      storage,
      mintId: () => "minted",
      kind: () => "phone",
      name: () => "iPhone",
    });
    await device();
    expect(await storage.getItemAsync("ogs.deviceId")).toBe("minted");
  });
});

describe("haptics failure", () => {
  it("is logged as a haptics failure", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("no engine");
    const store = createHapticsStore({
      impact: async () => {
        throw error;
      },
      notify: async () => {},
    });
    store.dispatch({ type: "IMPACT", style: "light" });
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith("[ogs-shell] haptics failed:", error);
    warn.mockRestore();
  });
});

describe("profileWithLogin dispatch", () => {
  it("passes the page's events to the profile", () => {
    const seen: ProfileEvents[] = [];
    const inner: Store<ProfileBridgeState, ProfileEvents> = {
      getSnapshot: () => ({ status: "asking" }),
      subscribe: () => () => {},
      dispatch: (e) => {
        seen.push(e);
      },
      reset: () => {},
      on: () => () => {},
    };
    profileWithLogin(inner, () => null).dispatch({ type: "REFRESH" });
    expect(seen).toEqual([{ type: "REFRESH" }]);
  });
});

describe("tvAddress", () => {
  it("is the launcher's host", () => {
    expect(tvAddress("https://ogs-tv.pages.dev/")).toBe("ogs-tv.pages.dev");
  });

  it("is the base as it is when it isn't a URL (or the scheme isn't at the start)", () => {
    expect(tvAddress("ogs-tv.pages.dev")).toBe("ogs-tv.pages.dev");
    expect(tvAddress("1http://tv.example/")).toBe("1http://tv.example/");
  });
});
