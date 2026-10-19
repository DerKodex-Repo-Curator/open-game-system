import { fakeContext } from "../__fixtures__/fake-context";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { ogsGameStores } from "../game-stores";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

function setup() {
  const net = fakeFetch({
    "POST /api/v1/games/rocket-crew/token": () => ({ status: 500 }),
    "POST /api/v1/me/instances": () => ({ status: 201, body: {} }),
  });
  const fake = fakeContext(net.fetch);
  const stores = ogsGameStores({ askPlayer: async () => true })(fake.ctx);
  return { ...fake, stores, net };
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("ogsGameStores, edges", () => {
  it("losing the identity closes the profile without asking for a game token", async () => {
    const { stores, setIdentity, net } = setup();
    const before = stores.profile.getSnapshot();
    const heard: unknown[] = [];
    stores.profile.subscribe((s) => heard.push(s));
    setIdentity(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(net.calls).toEqual([]);
    expect(stores.profile.getSnapshot()).toEqual(before);
    expect(heard).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("files a sitting report with a POST", async () => {
    const { stores, setIdentity, net } = setup();
    setIdentity({
      profile: { id: "g", handle: "player", name: "Player", sticker: "owl" },
      deviceId: "d",
      deviceToken: "guest-token",
      login: "guest",
    });
    stores.ogs.dispatch({
      type: "INSTANCE_REPORT",
      report: { instanceId: "rocket-crew:KQTP", appId: "rocket-crew", status: "active" },
    });
    await until(() => net.calls.some((c) => c.url.endsWith("/api/v1/me/instances")));
    expect(net.calls.find((c) => c.url.endsWith("/api/v1/me/instances"))?.method).toBe("POST");
  });
});
