import {
  type LinkingLike,
  type PushTapsLike,
  pushTapUrl,
  watchIncomingUrls,
} from "../incoming-links";

const tap = (url: unknown, identifier = "n1") => ({
  actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
  notification: { request: { identifier, content: { title: "t", body: "b", data: { url } } } },
});

function fakeLinking(initial: string | null) {
  const listeners = new Set<(e: { url: string }) => void>();
  const linking: LinkingLike = {
    getInitialURL: async () => initial,
    addEventListener: (_t, l) => {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    },
  };
  return {
    linking,
    open: (url: string) => {
      for (const l of listeners) l({ url });
    },
    listeners,
  };
}

function fakeTaps(last: unknown) {
  const listeners = new Set<(r: unknown) => void>();
  const taps: PushTapsLike = {
    getLastNotificationResponse: () => last,
    addNotificationResponseReceivedListener: (l) => {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    },
  };
  return {
    taps,
    tap: (r: unknown) => {
      for (const l of listeners) l(r);
    },
    listeners,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("pushTapUrl", () => {
  it("reads the url a push carries in its data", () => {
    expect(pushTapUrl(tap("https://play.rocketcrew.tv/room/AB"))).toBe(
      "https://play.rocketcrew.tv/room/AB",
    );
  });

  it("is null for a push without a url, or anything that isn't a notification response", () => {
    expect(pushTapUrl(tap(undefined))).toBeNull();
    expect(pushTapUrl(tap(42))).toBeNull();
    expect(pushTapUrl(tap(""))).toBeNull();
    expect(pushTapUrl(null)).toBeNull();
    expect(pushTapUrl({ notification: {} })).toBeNull();
  });
});

describe("watchIncomingUrls", () => {
  it("opens the link the app was launched with", async () => {
    const opened: string[] = [];
    const l = fakeLinking("https://opengame.org/play/rocket-crew/room/AB");
    watchIncomingUrls({
      linking: l.linking,
      pushTaps: fakeTaps(null).taps,
      open: (u) => opened.push(u),
    });
    await flush();
    expect(opened).toEqual(["https://opengame.org/play/rocket-crew/room/AB"]);
  });

  it("opens no launch link when there is none", async () => {
    const opened: string[] = [];
    watchIncomingUrls({
      linking: fakeLinking(null).linking,
      pushTaps: fakeTaps(null).taps,
      open: (u) => opened.push(u),
    });
    await flush();
    expect(opened).toEqual([]);
  });

  it("opens the push the app was launched by (a tap while it was closed)", async () => {
    const opened: string[] = [];
    watchIncomingUrls({
      linking: fakeLinking(null).linking,
      pushTaps: fakeTaps(tap("https://play.rocketcrew.tv/room/CD")).taps,
      open: (u) => opened.push(u),
    });
    await flush();
    expect(opened).toEqual(["https://play.rocketcrew.tv/room/CD"]);
  });

  it("follows links and push taps while running, once per push", async () => {
    const opened: string[] = [];
    const l = fakeLinking(null);
    const t = fakeTaps(null);
    watchIncomingUrls({ linking: l.linking, pushTaps: t.taps, open: (u) => opened.push(u) });
    await flush();
    l.open("https://rocketcrew.tv/a");
    t.tap(tap("https://play.rocketcrew.tv/b", "n2"));
    t.tap(tap("https://play.rocketcrew.tv/b", "n2"));
    t.tap(tap(undefined, "n3"));
    expect(opened).toEqual(["https://rocketcrew.tv/a", "https://play.rocketcrew.tv/b"]);
  });

  it("doesn't open the launch push twice when the listener reports it as well", async () => {
    const opened: string[] = [];
    const launch = tap("https://play.rocketcrew.tv/room/CD", "cold");
    const t = fakeTaps(launch);
    watchIncomingUrls({
      linking: fakeLinking(null).linking,
      pushTaps: t.taps,
      open: (u) => opened.push(u),
    });
    t.tap(launch);
    await flush();
    expect(opened).toEqual(["https://play.rocketcrew.tv/room/CD"]);
  });

  it("stops listening, and drops a launch link that answers after it stopped", async () => {
    const opened: string[] = [];
    const l = fakeLinking("https://rocketcrew.tv/late");
    const t = fakeTaps(null);
    const stop = watchIncomingUrls({
      linking: l.linking,
      pushTaps: t.taps,
      open: (u) => opened.push(u),
    });
    stop();
    await flush();
    expect(l.listeners.size).toBe(0);
    expect(t.listeners.size).toBe(0);
    expect(opened).toEqual([]);
  });

  it("works without push taps (no notifications module)", async () => {
    const opened: string[] = [];
    const l = fakeLinking("https://rocketcrew.tv/x");
    const stop = watchIncomingUrls({ linking: l.linking, open: (u) => opened.push(u) });
    await flush();
    stop();
    expect(opened).toEqual(["https://rocketcrew.tv/x"]);
  });

  it("ignores a launch link lookup that fails", async () => {
    const opened: string[] = [];
    const linking: LinkingLike = {
      getInitialURL: () => Promise.reject(new Error("no")),
      addEventListener: () => ({ remove: () => {} }),
    };
    watchIncomingUrls({ linking, open: (u) => opened.push(u) });
    await flush();
    expect(opened).toEqual([]);
  });

  it("opens no launch push when the notifications module can't say", async () => {
    const opened: string[] = [];
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const pushTaps: PushTapsLike = {
      getLastNotificationResponse: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'request')");
      },
      addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    };
    watchIncomingUrls({
      linking: fakeLinking(null).linking,
      pushTaps,
      open: (u) => opened.push(u),
    });
    await flush();
    expect(opened).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
