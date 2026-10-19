import { type LinkingLike, launchUrl, watchIncomingUrls } from "../incoming-links";

// iOS: a link handed to an app whose process is already starting (application:openURL: before the
// JS has a "url" listener) never reaches React Native's Linking: getInitialURL only reads the
// launch options and the "url" event has no listener yet. expo-linking keeps that URL natively
// (getLinkingURL), from launch on.

const flush = () => new Promise((r) => setTimeout(r, 0));

function startingApp(opts: { kept: string | null; launchOption?: string | null }) {
  const listeners = new Set<(e: { url: string }) => void>();
  const linking: LinkingLike = {
    getInitialURL: async () => opts.launchOption ?? null,
    getLinkingURL: () => opts.kept,
    addEventListener: (_t, l) => {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    },
  };
  return { linking, listeners };
}

describe("launchUrl", () => {
  it("is the link the OS handed the app before the JS listened", () => {
    const { linking } = startingApp({ kept: "rocket-crew://play/play.html" });
    expect(launchUrl(linking)).toBe("rocket-crew://play/play.html");
  });

  it("is null without one, or when the linking can't keep links", () => {
    expect(launchUrl(startingApp({ kept: null }).linking)).toBeNull();
    const plain: LinkingLike = {
      getInitialURL: async () => "rocket-crew://play/x",
      addEventListener: () => ({ remove: () => {} }),
    };
    expect(launchUrl(plain)).toBeNull();
  });

  it("is null when the native module throws", () => {
    const broken: LinkingLike = {
      getInitialURL: async () => null,
      getLinkingURL: () => {
        throw new Error("no ExpoLinking");
      },
      addEventListener: () => ({ remove: () => {} }),
    };
    expect(launchUrl(broken)).toBeNull();
  });
});

describe("watchIncomingUrls: a link that arrived while the app was starting", () => {
  it("opens it, though React Native's getInitialURL says there was none", async () => {
    const { linking } = startingApp({ kept: "rocket-crew://play/play.html", launchOption: null });
    const open = jest.fn();
    const stop = watchIncomingUrls({ linking, open });
    await flush();
    expect(open).toHaveBeenCalledWith("rocket-crew://play/play.html");
    stop();
  });

  it("prefers the kept link (the latest) over the launch option", async () => {
    const { linking } = startingApp({
      kept: "rocket-crew://play/join/ABCD",
      launchOption: "rocket-crew://play/play.html",
    });
    const open = jest.fn();
    const stop = watchIncomingUrls({ linking, open });
    await flush();
    expect(open.mock.calls).toEqual([["rocket-crew://play/join/ABCD"]]);
    stop();
  });

  it("still reads the launch option when nothing was kept", async () => {
    const { linking } = startingApp({ kept: null, launchOption: "rocket-crew://play/play.html" });
    const open = jest.fn();
    const stop = watchIncomingUrls({ linking, open });
    await flush();
    expect(open).toHaveBeenCalledWith("rocket-crew://play/play.html");
    stop();
  });
});
