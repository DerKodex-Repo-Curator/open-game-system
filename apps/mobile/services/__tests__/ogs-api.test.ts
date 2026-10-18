import { createOgsApi, OgsApiError } from "../ogs-api";

const BASE = "http://api.test";

const manifest = (appId: string, extra: Record<string, unknown> = {}) => ({
  appId,
  name: appId.replace("-", " "),
  shape: "couch",
  tv: "required",
  startUrl: `https://${appId}.example/`,
  tvUrl: `https://${appId}.example/tv`,
  art: { tile: `/art/${appId}/tv.jpg` },
  ...extra,
});

const instance = (instanceId: string, extra: Record<string, unknown> = {}) => ({
  instanceId,
  appId: "rocket-crew",
  profileId: "pr1",
  status: "suspended",
  title: "Mission 6",
  detail: "",
  updatedAt: 1000,
  source: "bridge",
  ...extra,
});

const profile = { id: "pr1", handle: "jonathan.m", name: "Jonathan", sticker: "bear" };
const me = { profile, logins: [] };
const device = { deviceId: "d1", kind: "phone" as const, name: "Jonathan's phone" };

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(respond: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  return { calls, fetchImpl };
}

function api(respond: (call: Call) => { status?: number; body: unknown }, token = "tok") {
  const f = fakeFetch(respond);
  const client = createOgsApi({
    baseUrl: BASE,
    fetch: f.fetchImpl,
    auth: () => (token ? { token } : null),
  });
  return { client, ...f };
}

const errorBody = (code: string, status: number) => ({
  status,
  body: { error: { code, message: code, status } },
});

describe("ogs-api: handles", () => {
  it("checks the @id a name would get", async () => {
    const { client, calls } = api(() => ({
      body: { handle: "jonathan.m", available: true, suggestion: "jonathan.m" },
    }));
    expect(await client.checkHandle({ name: "Jonathan Mumm" })).toEqual({
      handle: "jonathan.m",
      available: true,
      suggestion: "jonathan.m",
    });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/handles?name=Jonathan%20Mumm`,
      method: "GET",
    });
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it("checks a typed @id", async () => {
    const { client, calls } = api(() => ({
      body: { handle: "jonny", available: false, suggestion: "jonny2" },
    }));
    expect((await client.checkHandle({ handle: "jonny" })).suggestion).toBe("jonny2");
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/handles?handle=jonny`);
  });

  it("rejects a malformed handle answer at the boundary", async () => {
    const { client } = api(() => ({ body: { handle: "x" } }));
    await expect(client.checkHandle({ name: "x" })).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});

describe("ogs-api: profiles", () => {
  it("makes a profile with this device and returns the profile and its device token", async () => {
    const { client, calls } = api(() => ({ status: 201, body: { profile, token: "jwt" } }), "");
    const out = await client.createProfile({
      name: "Jonathan",
      handle: "jonathan.m",
      sticker: "bear",
      device,
    });
    expect(out).toEqual({ profile, token: "jwt" });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/profiles`,
      method: "POST",
      body: { name: "Jonathan", handle: "jonathan.m", sticker: "bear", device },
    });
  });

  it("surfaces 409 handle_taken", async () => {
    const { client } = api(() => errorBody("handle_taken", 409), "");
    await expect(
      client.createProfile({ name: "J", handle: "jonathan.m", sticker: "bear", device }),
    ).rejects.toMatchObject({ code: "handle_taken", status: 409 });
  });

  it("rejects a malformed profile at the boundary", async () => {
    const { client } = api(() => ({ status: 201, body: { profile: { id: "x" }, token: "t" } }));
    await expect(
      client.createProfile({ name: "J", sticker: "bear", device }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("reads /me with the device token", async () => {
    const { client, calls } = api(() => ({
      body: { profile, logins: [{ provider: "google", email: "j@example.com" }] },
    }));
    expect(await client.me()).toEqual({
      profile,
      logins: [{ provider: "google", email: "j@example.com" }],
    });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/me`,
      headers: { authorization: "Bearer tok" },
    });
  });

  it("edits the profile with PATCH /me", async () => {
    const { client, calls } = api(() => ({
      body: { profile: { ...profile, name: "Jon" }, logins: [] },
    }));
    expect((await client.updateMe({ name: "Jon" })).profile.name).toBe("Jon");
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/me`,
      method: "PATCH",
      body: { name: "Jon" },
    });
  });

  it("refuses profile calls before this device has a profile", async () => {
    const { client, fetchImpl } = api(() => ({ body: {} }), "");
    await expect(client.me()).rejects.toMatchObject({ code: "NO_PROFILE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ogs-api: couch sessions", () => {
  const info = { sessionId: "s1", code: "KITE42", tvName: "Living room TV", host: profile };

  it("casting makes a session and returns its launcher token and TV code", async () => {
    const { client, calls } = api(() => ({ status: 201, body: { ...info, token: "launch" } }));
    expect(await client.createSession("Living room TV")).toEqual({ ...info, token: "launch" });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/sessions`,
      method: "POST",
      body: { tvName: "Living room TV" },
      headers: { authorization: "Bearer tok" },
    });
  });

  it("joins a session with the TV code", async () => {
    const { client, calls } = api(() => ({ body: info }));
    expect(await client.joinSession("KITE42")).toEqual(info);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/sessions/join`,
      method: "POST",
      body: { code: "KITE42" },
    });
  });

  it("a wrong code answers session_not_found", async () => {
    const { client } = api(() => errorBody("session_not_found", 404));
    await expect(client.joinSession("NOPE00")).rejects.toMatchObject({
      code: "session_not_found",
    });
  });
});

// 2026-10-17-browser-tv.feature: claim a browser TV by its code, show a launcher there, stop.
describe("ogs-api: browser TVs", () => {
  it("claims a screen by its code", async () => {
    const { client, calls } = api(() => ({ body: { screenId: "sc1", name: "Browser TV" } }));
    expect(await client.claimScreen("HSUNH9")).toEqual({ screenId: "sc1", name: "Browser TV" });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/screens/claim`,
      method: "POST",
      body: { code: "HSUNH9" },
      headers: { authorization: "Bearer tok" },
    });
  });

  it("a code no screen shows answers screen_not_found", async () => {
    const { client } = api(() => errorBody("screen_not_found", 404));
    await expect(client.claimScreen("QQQQQQ")).rejects.toMatchObject({ code: "screen_not_found" });
  });

  it("shows a launcher token on a screen, and stops it", async () => {
    const { client, calls } = api(() => ({ status: 204, body: undefined }));
    await client.showOnScreen("sc1", "lt");
    await client.stopScreen("sc1");
    expect(calls.map((c) => [c.url, c.method, c.body])).toEqual([
      [`${BASE}/api/v1/screens/sc1/show`, "POST", { token: "lt" }],
      [`${BASE}/api/v1/screens/sc1/stop`, "POST", undefined],
    ]);
  });
});

describe("ogs-api: join a friend's cast", () => {
  it("joins the session by id (the Join card), no code", async () => {
    const info = {
      sessionId: "s1",
      code: "KITE42",
      tvName: "Living room TV",
      host: profile,
    };
    const { client, calls } = api(() => ({ body: info }));
    expect(await client.joinFriendSession("s1")).toEqual(info);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/sessions/s1/join`,
      method: "POST",
      headers: { authorization: "Bearer tok" },
    });
  });

  it("a host who is not a friend answers not_a_friend", async () => {
    const { client } = api(() => errorBody("not_a_friend", 403));
    await expect(client.joinFriendSession("s1")).rejects.toMatchObject({ code: "not_a_friend" });
  });
});

describe("ogs-api: back up and sign in", () => {
  it("backs up with Google: links the login to this profile with the device token", async () => {
    const { client, calls } = api(() => ({
      body: { profile, logins: [{ provider: "google", email: "j@example.com" }] },
    }));
    const out = await client.backUp({ provider: "google", idToken: "gid" });
    expect(out.logins).toEqual([{ provider: "google", email: "j@example.com" }]);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/auth/google`,
      method: "POST",
      body: { idToken: "gid" },
      headers: { authorization: "Bearer tok" },
    });
  });

  it("backs up with Apple", async () => {
    const { client, calls } = api(() => ({ body: me }));
    await client.backUp({ provider: "apple", idToken: "aid" });
    expect(calls[0]).toMatchObject({ url: `${BASE}/api/v1/auth/apple`, body: { idToken: "aid" } });
  });

  it("backs up with an email code", async () => {
    const { client, calls } = api(() => ({ body: me }));
    await client.backUp({ provider: "email", email: "j@example.com", code: "123456" });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/auth/email/verify`,
      body: { email: "j@example.com", code: "123456" },
    });
  });

  it("signs in without a token, sending this device, and returns the profile and a new token", async () => {
    const { client, calls } = api(() => ({ body: { ...me, token: "new-jwt" } }));
    const out = await client.signIn(
      { provider: "email", email: "j@example.com", code: "123456" },
      device,
    );
    expect(out).toEqual({ me, token: "new-jwt" });
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/auth/email/verify`,
      body: { email: "j@example.com", code: "123456", device },
    });
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it("signing in with a login no profile has answers login_not_found", async () => {
    const { client } = api(() => errorBody("login_not_found", 404));
    await expect(
      client.signIn({ provider: "google", idToken: "gid" }, device),
    ).rejects.toMatchObject({ code: "login_not_found", status: 404 });
  });

  it("a sign-in answer without a token is refused at the boundary", async () => {
    const { client } = api(() => ({ body: me }));
    await expect(
      client.signIn({ provider: "apple", idToken: "aid" }, device),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("starts an email sign-in (sends the code)", async () => {
    const { client, calls } = api(() => ({ status: 202, body: { sent: true } }));
    await client.startEmail("j@example.com");
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/auth/email/start`,
      method: "POST",
      body: { email: "j@example.com" },
    });
  });
});

describe("ogs-api: catalogue and library", () => {
  it("parses the catalogue's manifests and skips any that don't parse", async () => {
    const { client, calls } = api(() => ({
      body: [manifest("rocket-crew"), { appId: "BROKEN" }, manifest("word-duel", { tv: "none" })],
    }));
    const games = await client.catalogue();
    expect(games.map((g) => g.appId)).toEqual(["rocket-crew", "word-duel"]);
    expect(games[0]?.instanceTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/catalogue`);
  });

  it("reads the profile's library as appIds", async () => {
    const { client, calls } = api(() => ({ body: { appIds: ["night-flight"] } }));
    expect(await client.library()).toEqual(["night-flight"]);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/me/library`);
  });

  it("replaces the library with PUT", async () => {
    const { client, calls } = api(() => ({ body: { appIds: ["rocket-crew", "night-flight"] } }));
    expect(await client.setLibrary(["rocket-crew", "night-flight"])).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/me/library`,
      method: "PUT",
      body: { appIds: ["rocket-crew", "night-flight"] },
    });
  });

  it("Add by link fetches and parses the game's manifest", async () => {
    const { client, calls } = api(() => ({ body: manifest("my-game") }));
    expect((await client.fetchManifest("https://me.example/ogs.json")).appId).toBe("my-game");
    expect(calls[0]?.url).toBe("https://me.example/ogs.json");
  });

  it("Add by link refuses something that isn't a manifest", async () => {
    const { client } = api(() => ({ body: { hello: "world" } }));
    await expect(client.fetchManifest("https://me.example/x")).rejects.toMatchObject({
      code: "BAD_MANIFEST",
    });
  });
});

describe("ogs-api: instances", () => {
  it("lists the profile's instances, dropping malformed ones", async () => {
    const { client, calls } = api(() => ({ body: [instance("i1"), { instanceId: 3 }] }));
    expect((await client.instances()).map((i) => i.instanceId)).toEqual(["i1"]);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/me/instances`);
  });

  it("posts a report with its source", async () => {
    const { client, calls } = api(() => ({ body: instance("i1") }));
    const report = {
      instanceId: "i1",
      appId: "rocket-crew",
      status: "suspended" as const,
      title: "Mission 6",
      detail: "",
    };
    const out = await client.reportInstance(report, "bridge");
    expect(out.instanceId).toBe("i1");
    expect(calls[0]).toMatchObject({
      url: `${BASE}/api/v1/me/instances`,
      method: "POST",
      body: { ...report, source: "bridge" },
    });
  });
});

describe("ogs-api: errors", () => {
  it("surfaces the API's error contract", async () => {
    const { client } = api(() => ({
      status: 401,
      body: { error: { code: "invalid_token", message: "Bad token", status: 401 } },
    }));
    const err = await client.library().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OgsApiError);
    expect(err).toMatchObject({ code: "invalid_token", message: "Bad token", status: 401 });
  });

  it("names a non-JSON failure by its HTTP status", async () => {
    const { client } = api(() => ({ status: 502, body: "<html>bad gateway</html>" }));
    await expect(client.catalogue()).rejects.toMatchObject({ code: "HTTP_502", status: 502 });
  });

  it("turns a network failure into an OFFLINE error", async () => {
    const client = createOgsApi({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
      auth: () => null,
    });
    await expect(client.catalogue()).rejects.toMatchObject({ code: "OFFLINE", status: 0 });
  });
});
