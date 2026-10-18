import { act, create, type ReactTestInstance } from "react-test-renderer";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import type { LinkingLike, PushTapsLike } from "../incoming-links";
import { OgsShell } from "../OgsShell";
import type { OgsShellConfig } from "../runtime-config";
import { createShellRuntime } from "../shell-runtime";

jest.mock("@open-game-system/app-bridge-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BridgedWebView: (props: Record<string, unknown>) => <View testID="bridged" {...props} />,
  };
});
jest.mock("../default-deps", () => ({ defaultShellDeps: () => ({}) }));

const config: OgsShellConfig = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: ["rocketcrew.tv"],
  branding: "hidden",
};

const tap = (url: string, identifier: string) => ({
  actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
  notification: { request: { identifier, content: { title: "", body: "", data: { url } } } },
});

const noLinks: LinkingLike = {
  getInitialURL: async () => null,
  addEventListener: () => ({ remove: () => {} }),
};

function fakeTaps(last: unknown) {
  const listeners = new Set<(r: unknown) => void>();
  const pushTaps: PushTapsLike = {
    getLastNotificationResponse: () => last,
    addNotificationResponseReceivedListener: (l) => {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    },
  };
  return {
    pushTaps,
    tap: (r: unknown) => {
      for (const l of listeners) l(r);
    },
    listeners,
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
  });
  return createShellRuntime(config, {
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
    signInProviders: [],
  });
}

async function render(taps: ReturnType<typeof fakeTaps>) {
  const runtime = makeRuntime();
  const appState = { currentState: "active", addEventListener: () => ({ remove: () => {} }) };
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <OgsShell
        config={config}
        runtime={runtime}
        linking={noLinks}
        pushTaps={taps.pushTaps}
        appState={appState}
      />,
    );
  });
  await act(async () => {
    await runtime.idle();
  });
  return tree;
}

const uri = (root: ReactTestInstance) => {
  const [wv] = root.findAll((n) => n.props.testID === "bridged" && typeof n.type !== "string");
  if (!wv) throw new Error("no WebView");
  return wv.props.source.uri;
};

jest.setTimeout(30000);
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("<OgsShell /> push taps", () => {
  it("opens the page of the push that launched the app", async () => {
    const taps = fakeTaps(tap("https://play.rocketcrew.tv/room/AB", "cold"));
    const tree = await render(taps);
    expect(uri(tree.root)).toBe("https://play.rocketcrew.tv/room/AB");
  });

  it("opens a tapped push's page while running; a push for elsewhere is ignored", async () => {
    const taps = fakeTaps(null);
    const tree = await render(taps);
    expect(uri(tree.root)).toBe("https://play.rocketcrew.tv/phone");
    act(() => taps.tap(tap("https://opengame.org/play/rocket-crew/room/CD", "n1")));
    expect(uri(tree.root)).toBe("https://play.rocketcrew.tv/room/CD");
    act(() => taps.tap(tap("https://elsewhere.example/x", "n2")));
    expect(uri(tree.root)).toBe("https://play.rocketcrew.tv/room/CD");
  });

  it("stops listening for push taps when unmounted", async () => {
    const taps = fakeTaps(null);
    const tree = await render(taps);
    expect(taps.listeners.size).toBe(1);
    act(() => tree.unmount());
    expect(taps.listeners.size).toBe(0);
  });
});
