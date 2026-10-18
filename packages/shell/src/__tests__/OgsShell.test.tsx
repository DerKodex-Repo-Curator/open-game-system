import { act, create, type ReactTestInstance } from "react-test-renderer";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { type LinkingLike, OgsShell } from "../OgsShell";
import type { OgsShellConfig } from "../runtime-config";
import { createShellRuntime } from "../shell-runtime";

jest.mock("@open-game-system/app-bridge-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BridgedWebView: (props: Record<string, unknown>) => <View testID="bridged" {...props} />,
  };
});
// OgsShell's defaults (expo native modules) are never used here: every test passes a runtime.
jest.mock("../default-deps", () => ({ defaultShellDeps: () => ({}) }));

const config: OgsShellConfig = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: [],
  branding: "hidden",
};

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
  };
}

function fakeAppState() {
  const listeners = new Set<(s: string) => void>();
  return {
    appState: {
      currentState: "active",
      addEventListener: (_t: "change", l: (s: string) => void) => {
        listeners.add(l);
        return { remove: () => listeners.delete(l) };
      },
    },
    go: (s: string) => {
      for (const l of listeners) l(s);
    },
  };
}

function makeRuntime() {
  const net = fakeFetch({
    "POST /api/v1/profiles": () => ({
      status: 201,
      body: {
        profile: { id: "g", handle: "player", name: "Player", sticker: "owl" },
        token: "guest",
      },
    }),
    "POST /api/v1/auth/native": () => ({
      status: 200,
      body: {
        profile: { id: "g", handle: "jon", name: "Jon", sticker: "owl" },
        logins: [{ provider: "apple", email: null }],
        token: "apple-token",
      },
    }),
  });
  const runtime = createShellRuntime(config, {
    fetch: net.fetch,
    storage: fakeStorage().storage,
    device: async () => ({ deviceId: "d", kind: "phone", name: "iPhone" }),
    notifications: {
      getPermissionsAsync: async () => ({ granted: false }),
      requestPermissionsAsync: async () => ({ granted: false }),
      getDevicePushTokenAsync: async () => ({ type: "ios", data: "t" }),
      addPushTokenListener: () => ({ remove: () => {} }),
    },
    platform: "ios",
    apnsEnvironment: async () => "production",
    haptics: { impact: async () => {}, notify: async () => {} },
    signInProviders: [
      {
        provider: "apple",
        isAvailable: async () => true,
        signIn: async () => ({ status: "ok", identityToken: "jwt" }),
      },
    ],
  });
  return { runtime, calls: net.calls };
}

async function render(over: { initial?: string | null; branding?: "hidden" | "powered-by" } = {}) {
  const { runtime, calls } = makeRuntime();
  const links = fakeLinking(over.initial ?? null);
  const app = fakeAppState();
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <OgsShell
        config={{ ...config, branding: over.branding ?? "hidden" }}
        runtime={runtime}
        linking={links.linking}
        appState={app.appState}
      />,
    );
  });
  await act(async () => {
    await runtime.idle();
  });
  return { tree, runtime, calls, links, app };
}

const find = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
const webView = (root: ReactTestInstance) => {
  const [wv] = find(root, "bridged");
  if (!wv) throw new Error("no WebView");
  return wv;
};

// The first render loads react-native and the bridge from source: slow on a cold, busy machine.
jest.setTimeout(30000);

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("<OgsShell />", () => {
  it("opens straight into the game's page, loading until it loads", async () => {
    const { tree, runtime } = await render();
    expect(webView(tree.root).props.source).toEqual({ uri: "https://play.rocketcrew.tv/phone" });
    expect(webView(tree.root).props.bridge).toBe(runtime.bridge);
    expect(find(tree.root, "shellLoading").length).toBeGreaterThan(0);
    act(() => webView(tree.root).props.onLoad());
    expect(find(tree.root, "shellLoading")).toHaveLength(0);
  });

  it("starts the runtime: a guest profile", async () => {
    const { runtime } = await render();
    expect(runtime.getIdentity()).toMatchObject({ login: "guest" });
  });

  it("shows the offline screen when the page can't load, and retries on tap", async () => {
    const { tree } = await render();
    act(() => webView(tree.root).props.onError());
    expect(find(tree.root, "bridged")).toHaveLength(0);
    const [retry] = tree.root.findAll(
      (n) => n.props.testID === "gameRetryButton" && typeof n.props.onPress === "function",
    );
    act(() => retry?.props.onPress());
    expect(find(tree.root, "bridged")).toHaveLength(1);
    expect(find(tree.root, "gameErrorScreen")).toHaveLength(0);
  });

  it("retries by itself when the app comes back to the foreground while offline", async () => {
    const { tree, app } = await render();
    act(() => webView(tree.root).props.onError());
    act(() => app.go("background"));
    act(() => app.go("active"));
    expect(find(tree.root, "bridged")).toHaveLength(1);
  });

  it("opens the link the app was launched with, mapped onto the game", async () => {
    const { tree } = await render({ initial: "https://opengame.org/play/rocket-crew/join/AB?t=1" });
    expect(webView(tree.root).props.source).toEqual({
      uri: "https://play.rocketcrew.tv/join/AB?t=1",
    });
  });

  it("follows a link opened while running, and ignores links for other places", async () => {
    const { tree, links } = await render();
    act(() => links.open("https://elsewhere.example/x"));
    expect(webView(tree.root).props.source).toEqual({ uri: "https://play.rocketcrew.tv/phone" });
    act(() => links.open("https://play.rocketcrew.tv/room/7?from=push"));
    expect(webView(tree.root).props.source).toEqual({
      uri: "https://play.rocketcrew.tv/room/7?from=push",
    });
  });

  it("shows the native sign-in sheet when the game asks, and signs in with Apple", async () => {
    const { tree, runtime, calls } = await render();
    expect(find(tree.root, "signInSheet")).toHaveLength(0);
    await act(async () => {
      runtime.bridge.handleWebMessage(
        JSON.stringify({ type: "EVENT", storeKey: "account", event: { type: "SIGN_IN" } }),
      );
      await runtime.idle();
    });
    const [apple] = tree.root.findAll(
      (n) => n.props.testID === "signInApple" && typeof n.props.onPress === "function",
    );
    expect(apple).toBeDefined();
    await act(async () => {
      apple?.props.onPress();
      await runtime.idle();
    });
    expect(calls.some((c) => c.url.endsWith("/api/v1/auth/native"))).toBe(true);
    expect(runtime.getIdentity()).toMatchObject({ login: "apple" });
    expect(
      tree.root.findAll(
        (n) => n.props.testID === "signInApple" && typeof n.props.onPress === "function",
      ),
    ).toHaveLength(0);
  });

  it("shows 'Powered by OGS' while loading only when branding is powered-by", async () => {
    const hidden = await render();
    expect(find(hidden.tree.root, "poweredByOgs")).toHaveLength(0);
    const shown = await render({ branding: "powered-by" });
    expect(find(shown.tree.root, "poweredByOgs").length).toBeGreaterThan(0);
    act(() => webView(shown.tree.root).props.onLoad());
    expect(find(shown.tree.root, "poweredByOgs")).toHaveLength(0);
  });

  it("stops the runtime when unmounted", async () => {
    const { tree, runtime } = await render();
    const stop = jest.spyOn(runtime, "stop");
    act(() => tree.unmount());
    expect(stop).toHaveBeenCalled();
  });
});
