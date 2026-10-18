import { createShellRequest } from "../api-client";
import { createGuestApi, ensureGuestProfile, GUEST_STICKERS } from "../guest-profile";
import { IDENTITY_KEY, loadIdentity, saveIdentity } from "../identity";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";

const device = { deviceId: "dev-1", kind: "phone" as const, name: "Jon's iPhone" };
const created = {
  profile: { id: "p-1", handle: "player", name: "Player", sticker: "owl" },
  token: "device-token-1",
};

function setup(
  answer: Parameters<typeof fakeFetch>[0][string] = () => ({ status: 201, body: created }),
) {
  const { fetch, calls } = fakeFetch({ "POST /api/v1/profiles": answer });
  const api = createGuestApi(createShellRequest({ baseUrl: "https://api.test", fetch }));
  const { storage, items } = fakeStorage();
  const deps = { api, storage, device: async () => device, random: () => 0.2 };
  return { calls, storage, items, deps };
}

describe("ensureGuestProfile", () => {
  it("on first launch makes a device profile and saves its identity in secure storage", async () => {
    const { calls, storage, deps } = setup();
    const identity = await ensureGuestProfile(deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.test/api/v1/profiles");
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.body).toEqual({
      name: "Player",
      sticker: GUEST_STICKERS[1],
      device,
    });
    expect(identity).toEqual({
      profile: created.profile,
      deviceId: "dev-1",
      deviceToken: "device-token-1",
      login: "guest",
    });
    await expect(loadIdentity(storage)).resolves.toEqual(identity);
  });

  it("uses the game's guest name when given", async () => {
    const { calls, deps } = setup();
    await ensureGuestProfile({ ...deps, guestName: "Cadet" });
    expect(calls[0]?.body).toMatchObject({ name: "Cadet" });
  });

  it("picks a sticker from the list by the random number", async () => {
    const first = setup();
    await ensureGuestProfile({ ...first.deps, random: () => 0 });
    expect(first.calls[0]?.body).toMatchObject({ sticker: GUEST_STICKERS[0] });
    const last = setup();
    await ensureGuestProfile({ ...last.deps, random: () => 0.9999 });
    expect(last.calls[0]?.body).toMatchObject({
      sticker: GUEST_STICKERS[GUEST_STICKERS.length - 1],
    });
  });

  it("is idempotent: a stored identity is returned without asking the API", async () => {
    const { calls, storage, deps } = setup();
    const stored = {
      profile: created.profile,
      deviceId: "dev-0",
      deviceToken: "older",
      login: "apple" as const,
    };
    await saveIdentity(storage, stored);
    await expect(ensureGuestProfile(deps)).resolves.toEqual(stored);
    await expect(ensureGuestProfile(deps)).resolves.toEqual(stored);
    expect(calls).toHaveLength(0);
  });

  it("makes one profile when called twice at once", async () => {
    const { calls, deps } = setup();
    const [a, b] = await Promise.all([ensureGuestProfile(deps), ensureGuestProfile(deps)]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });

  it("fails without saving when the API can't be reached, and tries again next time", async () => {
    let offline = true;
    const { calls, items, deps } = setup(() =>
      offline ? new TypeError("Network request failed") : { status: 201, body: created },
    );
    await expect(ensureGuestProfile(deps)).rejects.toMatchObject({ code: "OFFLINE" });
    expect(items.has(IDENTITY_KEY)).toBe(false);
    offline = false;
    await expect(ensureGuestProfile(deps)).resolves.toMatchObject({
      deviceToken: "device-token-1",
    });
    expect(calls).toHaveLength(2);
  });

  it("rejects an answer without a token", async () => {
    const { items, deps } = setup(() => ({ status: 201, body: { profile: created.profile } }));
    await expect(ensureGuestProfile(deps)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    expect(items.has(IDENTITY_KEY)).toBe(false);
  });
});
