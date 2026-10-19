import { fakeFetch } from "../__fixtures__/fake-fetch";
import { createShellRequest } from "../api-client";
import { createScreenCastBackend } from "../screen-cast";
import { createShellScreensApi } from "../screens-api";
import type { ShellIdentity } from "../shell-identity";

const identity: ShellIdentity = {
  profile: { id: "p", handle: "player", name: "Player", sticker: "owl" },
  deviceId: "d",
  deviceToken: "device-token",
  login: "guest",
};

function setup(id: ShellIdentity | null = identity) {
  const net = fakeFetch({
    "POST /api/v1/screens/claim": ({ body }) =>
      JSON.stringify(body) === JSON.stringify({ code: "QQQQQQ" })
        ? {
            status: 404,
            body: { error: { code: "screen_not_found", message: "No screen", status: 404 } },
          }
        : { status: 200, body: { screenId: "sc1", name: "Browser TV" } },
    "POST /api/v1/screens/sc1/show": () => ({ status: 204 }),
    "POST /api/v1/screens/sc1/stop": () => ({ status: 204 }),
  });
  const api = createShellScreensApi({
    request: createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch }),
    getIdentity: () => id,
  });
  return { api, net };
}

describe("createShellScreensApi (browser TVs on the OGS API, with the device token)", () => {
  it("claims a screen by its code", async () => {
    const { api, net } = setup();
    expect(await api.claim("KQTP7X")).toEqual({ screenId: "sc1", name: "Browser TV" });
    expect(net.calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.test/api/v1/screens/claim",
      body: { code: "KQTP7X" },
      headers: { Authorization: "Bearer device-token" },
    });
  });

  it("shows a launcher token, with the app for a chromeless cast", async () => {
    const { api, net } = setup();
    await api.show("sc1", "launcher-token");
    await api.show("sc1", "launcher-token", "rocket-crew");
    expect(net.calls.map((c) => c.body)).toEqual([
      { token: "launcher-token" },
      { token: "launcher-token", app: "rocket-crew" },
    ]);
  });

  it("stops a screen", async () => {
    const { api, net } = setup();
    await api.stop("sc1");
    expect(net.calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.test/api/v1/screens/sc1/stop",
    });
  });

  it("fails with no profile yet", async () => {
    const { api, net } = setup(null);
    await expect(api.claim("KQTP7X")).rejects.toThrow(/profile/);
    expect(net.calls).toHaveLength(0);
  });

  it("a wrong code reads as such in the browser-TV backend", async () => {
    const { api } = setup();
    const data: Record<string, string> = {};
    const screens = createScreenCastBackend({
      api,
      storage: {
        getItem: async (k) => data[k] ?? null,
        setItem: async (k, v) => {
          data[k] = v;
        },
      },
    });
    expect(await screens.addScreen("QQQQQQ")).toEqual({
      ok: false,
      message: "No TV shows that code. Check the code on the TV.",
    });
  });
});
