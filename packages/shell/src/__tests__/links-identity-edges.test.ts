import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { createShellRequest } from "../api-client";
import {
  createGuestApi,
  ensureGuestProfile,
  GUEST_STICKERS,
  type ShellDevice,
} from "../guest-profile";
import {
  type LinkingLike,
  launchUrl,
  type PushTapsLike,
  pushTapUrl,
  watchIncomingUrls,
} from "../incoming-links";
import { IDENTITY_KEY, loadShellIdentity } from "../shell-identity";

const flush = () => new Promise((r) => setTimeout(r, 0));

function linking(over: Partial<LinkingLike> = {}) {
  const events: string[] = [];
  const value: LinkingLike = {
    getInitialURL: async () => null,
    addEventListener: (type) => {
      events.push(type);
      return { remove: () => {} };
    },
    ...over,
  };
  return { value, events };
}

const tap = (id: string | undefined, data: unknown) => ({
  notification: { request: { ...(id === undefined ? {} : { identifier: id }), content: { data } } },
});

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("incoming links, edges", () => {
  it("a linking that keeps no links is no launch link, and nothing to warn about", () => {
    expect(launchUrl(linking().value)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("says why a kept link or a launch push couldn't be read", async () => {
    const error = new Error("native module gone");
    launchUrl(
      linking({
        getLinkingURL: () => {
          throw error;
        },
      }).value,
    );
    expect(warn).toHaveBeenCalledWith("[ogs-shell] no kept link:", error);
    const pushTaps: PushTapsLike = {
      getLastNotificationResponse: () => {
        throw error;
      },
      addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    };
    watchIncomingUrls({ linking: linking().value, pushTaps, open: () => {} });
    expect(warn).toHaveBeenCalledWith("[ogs-shell] no launch push:", error);
  });

  it("listens for url events, and without push taps warns about nothing", async () => {
    const l = linking();
    watchIncomingUrls({ linking: l.value, open: () => {} });
    await flush();
    expect(l.events).toEqual(["url"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a push with no data, or no url in it, opens nothing", async () => {
    expect(pushTapUrl(tap("n-1", null))).toBeNull();
    const opened: string[] = [];
    let listener: (r: unknown) => void = () => {};
    watchIncomingUrls({
      linking: linking().value,
      pushTaps: {
        getLastNotificationResponse: () => null,
        addNotificationResponseReceivedListener: (l) => {
          listener = l;
          return { remove: () => {} };
        },
      },
      open: (url) => opened.push(url),
    });
    listener(tap("n-1", null));
    listener(tap("n-2", undefined));
    expect(opened).toEqual([]);
  });

  it("pushes without an identifier each open", async () => {
    const opened: string[] = [];
    let listener: (r: unknown) => void = () => {};
    watchIncomingUrls({
      linking: linking().value,
      pushTaps: {
        getLastNotificationResponse: () => null,
        addNotificationResponseReceivedListener: (l) => {
          listener = l;
          return { remove: () => {} };
        },
      },
      open: (url) => opened.push(url),
    });
    listener(tap(undefined, { url: "https://a.test/1" }));
    listener(tap(undefined, { url: "https://a.test/2" }));
    expect(opened).toEqual(["https://a.test/1", "https://a.test/2"]);
  });
});

describe("shell identity, edges", () => {
  it("loads an identity signed in with Google", async () => {
    const identity = {
      profile: { id: "p", handle: "jon", name: "Jon", sticker: "owl" },
      deviceId: "d",
      deviceToken: "t",
      login: "google",
    };
    const { storage } = fakeStorage({ [IDENTITY_KEY]: JSON.stringify(identity) });
    await expect(loadShellIdentity(storage)).resolves.toEqual(identity);
  });
});

describe("guest sticker", () => {
  it("a random number of exactly 1 picks the last sticker", async () => {
    const device: ShellDevice = { deviceId: "dev-1", kind: "phone", name: "iPhone" };
    const net = fakeFetch({
      "POST /api/v1/profiles": () => ({
        status: 201,
        body: {
          profile: { id: "p", handle: "player", name: "Player", sticker: "owl" },
          token: "t",
        },
      }),
    });
    await ensureGuestProfile({
      api: createGuestApi(createShellRequest({ baseUrl: "https://api.test", fetch: net.fetch })),
      storage: fakeStorage().storage,
      device: async () => device,
      random: () => 1,
    });
    expect(net.calls[0]?.body).toMatchObject({ sticker: GUEST_STICKERS.at(-1) });
  });
});
