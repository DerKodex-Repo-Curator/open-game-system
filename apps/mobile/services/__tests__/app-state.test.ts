import type { Instance, Manifest } from "@open-game-system/ogs-protocol";
import { createAppState } from "../app-state";

beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

import { type Me, OgsApiError } from "../ogs-api";

const manifest = (appId: string): Manifest => ({
  appId,
  name: appId,
  tagline: "",
  shape: "couch",
  tv: "optional",
  startUrl: `https://${appId}.example/`,
  tvUrl: `https://${appId}.example/tv`,
  roles: [],
  art: { tile: "/t.jpg" },
  shop: {},
  instanceTtlMs: 1000,
});

const instance = (instanceId: string, patch: Partial<Instance> = {}): Instance => ({
  instanceId,
  appId: "rocket-crew",
  profileId: "pr1",
  status: "suspended",
  title: "",
  detail: "",
  updatedAt: 1,
  source: "bridge",
  ...patch,
});

const profile = { id: "pr1", handle: "jonathan.m", name: "Jonathan", sticker: "bear" };
const me = (patch: Partial<Me> = {}): Me => ({ profile, logins: [], ...patch });
const session = { sessionId: "s1", code: "KITE42", tvName: "Living room TV", host: profile };

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (k: string) => data.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void data.set(k, v),
    deleteItemAsync: async (k: string) => void data.delete(k),
  };
}

function fakeApi() {
  return {
    checkHandle: jest.fn(async (_q: { name: string } | { handle: string }) => ({
      handle: "jonathan.m",
      available: false,
      suggestion: "jonathan.m2",
    })),
    createProfile: jest.fn(async () => ({ profile, token: "jwt" })),
    me: jest.fn(async () => me()),
    updateMe: jest.fn(async () => me({ profile: { ...profile, name: "Jon" } })),
    createSession: jest.fn(async () => ({ ...session, token: "launch" })),
    joinSession: jest.fn(async () => session),
    joinFriendSession: jest.fn(async (_sid: string) => session),
    startEmail: jest.fn(async () => {}),
    backUp: jest.fn(async () =>
      me({ logins: [{ provider: "google" as const, email: "j@x.org" }] }),
    ),
    signIn: jest.fn(async () => ({
      me: me({ logins: [{ provider: "email" as const, email: "j@x.org" }] }),
      token: "jwt-2",
    })),
    catalogue: jest.fn(async () => [manifest("rocket-crew"), manifest("night-flight")]),
    library: jest.fn(async () => ["rocket-crew"]),
    setLibrary: jest.fn(async (ids: string[]) => ids),
    fetchManifest: jest.fn(async (_url: string) => manifest("night-flight")),
    instances: jest.fn(async () => [instance("i1")]),
    reportInstance: jest.fn(async () => instance("i2", { title: "Day 4" })),
  };
}

const newProfile = { name: "Jonathan", handle: "jonathan.m", sticker: "bear" };

function setup(storage = memory()) {
  const api = fakeApi();
  let n = 0;
  const app = createAppState({
    api,
    storage,
    device: { kind: "phone", name: "iPhone" },
    newDeviceId: () => `d${++n}`,
  });
  return { api, storage, app };
}

describe("app state: making a profile", () => {
  it("makes the profile with this device, stores the identity and uses it", async () => {
    const { app, api, storage } = setup();
    expect(await app.createProfile(newProfile)).toEqual({ ok: true });
    expect(api.createProfile).toHaveBeenCalledWith({
      ...newProfile,
      device: { deviceId: "d1", kind: "phone", name: "iPhone" },
    });
    expect(app.getSnapshot().identity).toEqual({ profile, deviceId: "d1", deviceToken: "jwt" });
    expect(app.getSnapshot().logins).toEqual([]);
    expect(storage.data.get("ogs.identity")).toContain("jonathan.m");
  });

  it("a taken @id answers with a free suggestion and stores nothing", async () => {
    const { app, api, storage } = setup();
    api.createProfile.mockRejectedValueOnce(new OgsApiError("handle_taken", "taken", 409));
    expect(await app.createProfile(newProfile)).toEqual({
      ok: false,
      reason: "handle_taken",
      suggestion: "jonathan.m2",
    });
    expect(api.checkHandle).toHaveBeenCalledWith({ handle: "jonathan.m" });
    expect(app.getSnapshot().identity).toBeNull();
    expect(storage.data.has("ogs.identity")).toBe(false);
  });

  it("says when OGS can't be reached", async () => {
    const { app, api } = setup();
    api.createProfile.mockRejectedValueOnce(new OgsApiError("OFFLINE", "no network", 0));
    expect(await app.createProfile(newProfile)).toEqual({
      ok: false,
      reason: "error",
      message: "Can't reach OGS. Check your Wi-Fi and try again.",
      action: "retry",
    });
  });

  it("only one profile per device: a second make is a no-op", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    expect(await app.createProfile({ ...newProfile, name: "Mom" })).toEqual({ ok: true });
    expect(api.createProfile).toHaveBeenCalledTimes(1);
  });

  it("init loads a stored identity without making anything", async () => {
    const first = setup();
    await first.app.createProfile(newProfile);
    const second = setup(first.storage);
    await second.app.init();
    expect(second.app.getSnapshot().identity?.profile.handle).toBe("jonathan.m");
    expect(second.api.createProfile).not.toHaveBeenCalled();
  });
});

describe("app state: a fresh install", () => {
  it("forgets a profile the Keychain kept from a deleted install (iOS keeps it)", async () => {
    const first = setup();
    await first.app.createProfile(newProfile);
    const api = fakeApi();
    let installed = false;
    const app = createAppState({
      api,
      storage: first.storage,
      device: { kind: "phone", name: "iPhone" },
      newDeviceId: () => "d9",
      install: {
        isFirstLaunch: async () => !installed,
        markLaunched: async () => {
          installed = true;
        },
      },
    });
    await app.init();
    expect(app.getSnapshot().identity).toBeNull();
    expect(first.storage.data.has("ogs.identity")).toBe(false);
    expect(installed).toBe(true);
  });

  it("keeps the profile on every later launch", async () => {
    const first = setup();
    await first.app.createProfile(newProfile);
    const app = createAppState({
      api: fakeApi(),
      storage: first.storage,
      device: { kind: "phone", name: "iPhone" },
      newDeviceId: () => "d9",
      install: { isFirstLaunch: async () => false, markLaunched: async () => {} },
    });
    await app.init();
    expect(app.getSnapshot().identity?.profile.handle).toBe("jonathan.m");
  });
});

describe("app state: signed out", () => {
  it("forgets the profile and the session on this device", async () => {
    const { app, storage } = setup();
    await app.createProfile(newProfile);
    await app.startSession("Living room TV");
    await app.signOut();
    expect(app.getSnapshot()).toMatchObject({ identity: null, session: null, logins: [] });
    expect(storage.data.has("ogs.identity")).toBe(false);
    expect(storage.data.has("ogs.session")).toBe(false);
  });
});

describe("app state: editing the profile", () => {
  it("PATCHes /me and keeps the new profile", async () => {
    const { app, api, storage } = setup();
    await app.createProfile(newProfile);
    expect(await app.updateProfile({ name: "Jon" })).toEqual({ ok: true });
    expect(api.updateMe).toHaveBeenCalledWith({ name: "Jon" });
    expect(app.getSnapshot().identity?.profile.name).toBe("Jon");
    expect(storage.data.get("ogs.identity")).toContain('"Jon"');
  });

  it("a taken @id offers a suggestion", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    api.updateMe.mockRejectedValueOnce(new OgsApiError("handle_taken", "taken", 409));
    expect(await app.updateProfile({ handle: "mom" })).toEqual({
      ok: false,
      reason: "handle_taken",
      suggestion: "jonathan.m2",
    });
    expect(api.checkHandle).toHaveBeenCalledWith({ handle: "mom" });
  });
});

describe("app state: back up and sign in", () => {
  it("backing up records the login (the Profile tab says Backed up)", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    expect(await app.backUp({ provider: "google", idToken: "gid" })).toEqual({ ok: true });
    expect(api.backUp).toHaveBeenCalledWith({ provider: "google", idToken: "gid" });
    expect(app.getSnapshot().logins).toEqual([{ provider: "google", email: "j@x.org" }]);
  });

  it("a login another profile has is refused with login_in_use", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    api.backUp.mockRejectedValueOnce(new OgsApiError("login_in_use", "in use", 409));
    expect(await app.backUp({ provider: "google", idToken: "gid" })).toEqual({
      ok: false,
      reason: "login_in_use",
      message: "That account already backs up another profile.",
      action: null,
    });
  });

  it("signing in on a new device stores the returned profile with a new device token", async () => {
    const { app, api, storage } = setup();
    const credential = { provider: "email" as const, email: "j@x.org", code: "123456" };
    expect(await app.signIn(credential)).toEqual({ ok: true });
    expect(api.signIn).toHaveBeenCalledWith(credential, {
      deviceId: "d1",
      kind: "phone",
      name: "iPhone",
    });
    expect(app.getSnapshot().identity).toEqual({
      profile,
      deviceId: "d1",
      deviceToken: "jwt-2",
    });
    expect(app.getSnapshot().logins).toEqual([{ provider: "email", email: "j@x.org" }]);
    expect(storage.data.get("ogs.identity")).toContain("jwt-2");
  });

  it("a login no profile has answers login_not_found", async () => {
    const { app, api } = setup();
    api.signIn.mockRejectedValueOnce(new OgsApiError("login_not_found", "none", 404));
    expect(await app.signIn({ provider: "google", idToken: "gid" })).toEqual({
      ok: false,
      reason: "login_not_found",
      message: "No OGS profile has that login yet.",
      action: "make-profile",
    });
    expect(app.getSnapshot().identity).toBeNull();
  });

  it("a wrong email code is an error to show", async () => {
    const { app, api } = setup();
    api.signIn.mockRejectedValueOnce(new OgsApiError("invalid_code", "Wrong code", 401));
    expect(await app.signIn({ provider: "email", email: "j@x.org", code: "000000" })).toMatchObject(
      { ok: false, reason: "invalid_code" },
    );
  });

  it("sends an email code", async () => {
    const { app, api } = setup();
    expect(await app.startEmail("j@x.org")).toEqual({ ok: true });
    expect(api.startEmail).toHaveBeenCalledWith("j@x.org");
  });
});

describe("app state: the couch session", () => {
  it("casting starts a session this profile hosts and returns the launcher token", async () => {
    const { app, api, storage } = setup();
    await app.createProfile(newProfile);
    expect(await app.startSession("Living room TV")).toBe("launch");
    expect(api.createSession).toHaveBeenCalledWith("Living room TV");
    expect(app.getSnapshot().session).toEqual({
      ...session,
      launcherToken: "launch",
      role: "host",
    });
    expect(storage.data.get("ogs.session")).toContain("s1");
  });

  it("joining with a TV code puts this device on that session", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    expect(await app.joinSession(" kite42 ")).toEqual({ ok: true });
    expect(api.joinSession).toHaveBeenCalledWith("KITE42");
    expect(app.getSnapshot().session).toEqual({ ...session, role: "member" });
  });

  it("a wrong code is refused with session_not_found", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    api.joinSession.mockRejectedValueOnce(new OgsApiError("session_not_found", "No such TV", 404));
    expect(await app.joinSession("NOPE00")).toEqual({
      ok: false,
      reason: "session_not_found",
      message: "No TV has that code.",
      action: null,
    });
    expect(app.getSnapshot().session).toBeNull();
  });

  it("joining a friend's cast (Join card) puts this device on that session", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    expect(await app.joinFriendSession(session.sessionId)).toEqual({ ok: true });
    expect(api.joinFriendSession).toHaveBeenCalledWith(session.sessionId);
    expect(app.getSnapshot().session).toEqual({ ...session, role: "member" });
  });

  it("a friend's cast that is gone or not a friend's is refused, and the session stays", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    api.joinFriendSession.mockRejectedValueOnce(new OgsApiError("not_a_friend", "No", 403));
    const result = await app.joinFriendSession("s9");
    expect(result).toMatchObject({ ok: false, reason: "not_a_friend" });
    api.joinFriendSession.mockRejectedValueOnce(new OgsApiError("session_not_found", "No", 404));
    expect(await app.joinFriendSession("s9")).toMatchObject({
      ok: false,
      reason: "session_not_found",
    });
    expect(app.getSnapshot().session).toBeNull();
  });

  it("leaving forgets the session", async () => {
    const { app, storage } = setup();
    await app.createProfile(newProfile);
    await app.joinSession("KITE42");
    await app.leaveSession();
    expect(app.getSnapshot().session).toBeNull();
    expect(storage.data.has("ogs.session")).toBe(false);
  });

  it("init restores a stored session", async () => {
    const first = setup();
    await first.app.createProfile(newProfile);
    await first.app.startSession("Living room TV");
    const second = setup(first.storage);
    await second.app.init();
    expect(second.app.getSnapshot().session?.sessionId).toBe("s1");
  });
});

describe("app state: library, catalogue, instances", () => {
  it("refresh loads them, and the logins, once there's a profile", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    api.me.mockResolvedValueOnce(me({ logins: [{ provider: "apple", email: null }] }));
    await app.refresh();
    const s = app.getSnapshot();
    expect(s.library.map((g) => g.appId)).toEqual(["rocket-crew"]);
    expect(s.catalogue).toHaveLength(2);
    expect(s.instances).toHaveLength(1);
    expect(s.logins).toEqual([{ provider: "apple", email: null }]);
    expect(s.status).toBe("ready");
  });

  it("without a profile only the catalogue loads", async () => {
    const { app, api } = setup();
    await app.refresh();
    expect(api.library).not.toHaveBeenCalled();
    expect(api.me).not.toHaveBeenCalled();
    expect(app.getSnapshot().catalogue).toHaveLength(2);
  });

  it("a token OGS no longer takes says signed out, with Sign in", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    api.me.mockRejectedValueOnce(new OgsApiError("profile_not_found", "gone", 404));
    await app.refresh();
    expect(app.getSnapshot().error).toEqual({
      text: "You've been signed out. Sign in again.",
      action: "sign-in",
    });
  });

  it("offline keeps what it had and says so", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    await app.refresh();
    api.library.mockRejectedValueOnce(new OgsApiError("OFFLINE", "no", 0));
    await app.refresh();
    expect(app.getSnapshot().status).toBe("offline");
    expect(app.getSnapshot().error).toEqual({
      text: "Can't reach OGS. Check your Wi-Fi and try again.",
      action: "retry",
    });
    expect(app.getSnapshot().library).toHaveLength(1);
  });

  it("adding a game appends it to the profile's library", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    await app.refresh();
    await app.addGame("night-flight");
    expect(api.setLibrary).toHaveBeenCalledWith(["rocket-crew", "night-flight"]);
    expect(app.getSnapshot().library.map((g) => g.appId)).toEqual(["rocket-crew", "night-flight"]);
  });

  it("Add by link adds a catalogue game from its manifest URL", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    await app.refresh();
    await app.addByLink("https://nf.example/ogs.json");
    expect(api.fetchManifest).toHaveBeenCalledWith("https://nf.example/ogs.json");
    expect(app.getSnapshot().library.map((g) => g.appId)).toContain("night-flight");
  });

  it("Add by link refuses a game OGS doesn't know yet", async () => {
    const { app, api } = setup();
    await app.createProfile(newProfile);
    await app.refresh();
    api.fetchManifest.mockResolvedValueOnce(manifest("my-own-game"));
    await expect(app.addByLink("https://me.example/ogs.json")).rejects.toMatchObject({
      code: "NOT_IN_CATALOGUE",
    });
  });

  it("a report replaces the instance with the same id", async () => {
    const { app } = setup();
    await app.createProfile(newProfile);
    await app.refresh();
    await app.report(
      { instanceId: "i2", appId: "rocket-crew", status: "suspended", title: "Day 4", detail: "" },
      "visit",
    );
    await app.report(
      { instanceId: "i2", appId: "rocket-crew", status: "suspended", title: "Day 4", detail: "" },
      "visit",
    );
    expect(app.getSnapshot().instances.map((i) => i.instanceId)).toEqual(["i2", "i1"]);
  });

  it("the return pill can be set and cleared", () => {
    const { app } = setup();
    app.setPill({ appId: "rocket-crew", name: "Rocket Crew", url: "https://rc/", at: 1 });
    expect(app.getSnapshot().pill?.name).toBe("Rocket Crew");
    app.setPill(null);
    expect(app.getSnapshot().pill).toBeNull();
  });

  it("notifies subscribers", async () => {
    const { app } = setup();
    const l = jest.fn();
    const off = app.subscribe(l);
    app.setPill(null);
    expect(l).toHaveBeenCalled();
    off();
  });
});

// 2026-10-18-invite-another-family.feature: a household that came through an invite casts its first
// couch with it (the API counts funnel.first_session); the invite is used once.
describe("app state: the invite a household came through", () => {
  it("goes with the cast, then is spent", async () => {
    let kept: string | null = "inv-1";
    const api = fakeApi();
    const app = createAppState({
      api,
      storage: memory(),
      device: { kind: "phone", name: "iPhone" },
      newDeviceId: () => "d1",
      invite: {
        current: async () => kept,
        clear: async () => {
          kept = null;
        },
      },
    });
    await app.createProfile(newProfile);
    await app.startSession("Browser TV");
    expect(api.createSession).toHaveBeenLastCalledWith("Browser TV", "inv-1");
    expect(kept).toBeNull();
    await app.startSession("Browser TV");
    expect(api.createSession).toHaveBeenLastCalledWith("Browser TV");
  });

  it("a cast that fails keeps the invite for the next one", async () => {
    let kept: string | null = "inv-1";
    const api = fakeApi();
    api.createSession.mockRejectedValueOnce(new Error("offline"));
    const app = createAppState({
      api,
      storage: memory(),
      device: { kind: "phone", name: "iPhone" },
      newDeviceId: () => "d1",
      invite: { current: async () => kept, clear: async () => void (kept = null) },
    });
    await app.createProfile(newProfile);
    await expect(app.startSession("Browser TV")).rejects.toThrow("offline");
    expect(kept).toBe("inv-1");
  });
});
