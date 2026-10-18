import { createInviteAttribution } from "../invite-attribution";

// 2026-10-18-invite-another-family.feature: the invite in a game link this phone opened, kept until
// its first cast spends it.
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => void data.set(k, v),
    removeItem: async (k: string) => void data.delete(k),
  };
}

describe("the invite this phone came through", () => {
  it("is kept under its own key, read, and cleared", async () => {
    const storage = memory();
    const invite = createInviteAttribution(storage);
    expect(await invite.current()).toBeNull();
    await invite.remember("6f0c2a9e-1b7d-4c3e-9a51-2f1d8c7b0e44");
    expect(storage.data.get("ogs.invite")).toBe("6f0c2a9e-1b7d-4c3e-9a51-2f1d8c7b0e44");
    expect(await invite.current()).toBe("6f0c2a9e-1b7d-4c3e-9a51-2f1d8c7b0e44");
    await invite.clear();
    expect(await invite.current()).toBeNull();
  });

  it("the latest link's invite wins", async () => {
    const invite = createInviteAttribution(memory());
    await invite.remember("a");
    await invite.remember("b");
    expect(await invite.current()).toBe("b");
  });
});
