import type { Store } from "@open-game-system/app-bridge-types";
import type { ProfileBridgeState, ProfileLogin } from "@open-game-system/ogs-protocol";
import { createGameProfile, type ProfileEvents } from "../game-profile";
import { profileWithLogin } from "../profile-login";

const grant = {
  token: "t",
  expiresAt: Date.now() + 3_600_000,
  profile: { id: "g", handle: "p", name: "P", avatar: "https://art.test/a.webp" },
};
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

function setup(initialLogin: ProfileLogin | null) {
  let login = initialLogin;
  const profile = createGameProfile({ fetchToken: async () => grant });
  const store: Store<ProfileBridgeState, ProfileEvents> = profileWithLogin(
    profile.store,
    () => login,
  );
  return { profile, store, setLogin: (l: ProfileLogin | null) => (login = l) };
}

describe("profileWithLogin", () => {
  it("adds the login to a ready profile, for getSnapshot and subscribers", async () => {
    const { profile, store } = setup("guest");
    const heard: ProfileBridgeState[] = [];
    const off = store.subscribe((s) => heard.push(s));
    profile.open("rocket-crew");
    await until(() => store.getSnapshot().status === "ready");
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      profile: { ...grant.profile, token: "t", login: "guest" },
    });
    expect(heard.at(-1)).toEqual(store.getSnapshot());
    off();
    profile.close();
  });

  it("keeps asking and none as they are, and a profile with no identity yet unchanged", async () => {
    const { profile, store } = setup(null);
    expect(store.getSnapshot()).toEqual({ status: "none" });
    profile.open("rocket-crew");
    await until(() => store.getSnapshot().status === "ready");
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      profile: { ...grant.profile, token: "t" },
    });
    profile.close();
  });

  it("gives the same snapshot while nothing changed, a new one when the login did", async () => {
    const { profile, store, setLogin } = setup("guest");
    profile.open("rocket-crew");
    await until(() => store.getSnapshot().status === "ready");
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    setLogin("apple");
    const next = store.getSnapshot();
    expect(next).not.toBe(first);
    expect(next).toMatchObject({ profile: { login: "apple" } });
    profile.close();
  });

  it("passes dispatch, reset and on through to the profile store", async () => {
    const { profile, store } = setup("guest");
    profile.open("rocket-crew");
    await until(() => store.getSnapshot().status === "ready");
    store.dispatch({ type: "REFRESH" });
    expect(typeof store.on("REFRESH", () => {})).toBe("function");
    store.reset();
    expect(store.getSnapshot()).toEqual({ status: "none" });
  });
});
