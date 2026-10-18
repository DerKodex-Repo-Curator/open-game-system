import { fakeStorage } from "../__fixtures__/fake-storage";
import { createDeviceSource, DEVICE_ID_KEY } from "../device";

describe("createDeviceSource", () => {
  it("mints the device id once and keeps it in secure storage", async () => {
    const { storage, items } = fakeStorage();
    let n = 0;
    const device = createDeviceSource({
      storage,
      mintId: () => `id-${++n}`,
      kind: () => "tablet",
      name: () => "Juneau's iPad",
    });
    await expect(device()).resolves.toEqual({
      deviceId: "id-1",
      kind: "tablet",
      name: "Juneau's iPad",
    });
    await expect(device()).resolves.toMatchObject({ deviceId: "id-1" });
    expect(items.get(DEVICE_ID_KEY)).toBe("id-1");
    const again = createDeviceSource({
      storage,
      mintId: () => "other",
      kind: () => "phone",
      name: () => "x",
    });
    await expect(again()).resolves.toMatchObject({ deviceId: "id-1" });
  });

  it("names an unnamed device by its kind, and clips long names to the API's 60", async () => {
    const { storage } = fakeStorage();
    const unnamed = createDeviceSource({
      storage,
      mintId: () => "a",
      kind: () => "phone",
      name: () => null,
    });
    await expect(unnamed()).resolves.toMatchObject({ name: "Phone" });
    const long = createDeviceSource({
      storage,
      mintId: () => "a",
      kind: () => "tablet",
      name: () => "y".repeat(80),
    });
    await expect(long()).resolves.toMatchObject({ name: "y".repeat(60) });
    const blank = createDeviceSource({
      storage,
      mintId: () => "a",
      kind: () => "tablet",
      name: () => "  ",
    });
    await expect(blank()).resolves.toMatchObject({ name: "Tablet" });
  });
});
