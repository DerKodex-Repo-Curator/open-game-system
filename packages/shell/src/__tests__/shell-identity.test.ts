import { fakeStorage } from "../__fixtures__/fake-storage";
import {
  IDENTITY_KEY,
  loadShellIdentity,
  type ShellIdentity,
  saveShellIdentity,
} from "../shell-identity";

const identity: ShellIdentity = {
  profile: { id: "p1", handle: "player", name: "Player", sticker: "owl" },
  deviceId: "d1",
  deviceToken: "tok",
  login: "guest",
};

describe("identity", () => {
  it("round-trips through secure storage under ogs.identity", async () => {
    const { storage, items } = fakeStorage();
    await saveShellIdentity(storage, identity);
    expect(IDENTITY_KEY).toBe("ogs.identity");
    expect(JSON.parse(items.get(IDENTITY_KEY) ?? "")).toEqual(identity);
    await expect(loadShellIdentity(storage)).resolves.toEqual(identity);
  });

  it("is null when nothing, junk, or the wrong shape is stored", async () => {
    await expect(loadShellIdentity(fakeStorage().storage)).resolves.toBeNull();
    await expect(
      loadShellIdentity(fakeStorage({ [IDENTITY_KEY]: "{" }).storage),
    ).resolves.toBeNull();
    await expect(
      loadShellIdentity(fakeStorage({ [IDENTITY_KEY]: JSON.stringify({ deviceId: "d" }) }).storage),
    ).resolves.toBeNull();
  });
});
