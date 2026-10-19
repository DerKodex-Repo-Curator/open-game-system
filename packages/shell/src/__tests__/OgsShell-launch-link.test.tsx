import { act, create, type ReactTestInstance } from "react-test-renderer";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import type { LinkingLike } from "../incoming-links";
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
// The default linking: expo-linking, which keeps the link the OS handed the app natively.
const mockKept: { url: string | null } = { url: null };
jest.mock("expo-linking", () => ({
  getLinkingURL: () => mockKept.url,
  getInitialURL: async () => null,
  addEventListener: () => ({ remove: () => {} }),
}));

const config: OgsShellConfig = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: [],
  branding: "hidden",
};
const LINK = "rocket-crew://play/play.html";
const TARGET = "https://play.rocketcrew.tv/play.html";

function makeRuntime() {
  const net = fakeFetch({
    "POST /api/v1/profiles": () => ({
      status: 201,
      body: { profile: { id: "g", handle: "player", name: "Player", sticker: "owl" }, token: "t" },
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

const noTaps = {
  getLastNotificationResponse: () => null,
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
};
const appState = { currentState: "active", addEventListener: () => ({ remove: () => {} }) };

/** Every uri the WebView was given, in order (a WebView mounted on gameUrl first loads gameUrl). */
async function sources(linking?: LinkingLike) {
  const runtime = makeRuntime();
  const seen: unknown[] = [];
  let tree!: ReturnType<typeof create>;
  const record = () => {
    const [wv] = tree.root.findAll(
      (n: ReactTestInstance) => n.props.testID === "bridged" && typeof n.type !== "string",
    );
    const uri = wv?.props.source?.uri;
    if (uri !== undefined && seen[seen.length - 1] !== uri) seen.push(uri);
  };
  act(() => {
    tree = create(
      <OgsShell
        config={config}
        runtime={runtime}
        linking={linking}
        pushTaps={noTaps}
        appState={appState}
      />,
    );
  });
  record();
  await act(async () => {
    await runtime.idle();
  });
  record();
  act(() => tree.unmount());
  return seen;
}

jest.setTimeout(30000);
beforeEach(() => {
  mockKept.url = null;
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("<OgsShell /> started by a link", () => {
  it("loads the linked page first, never the game's start page", async () => {
    const linking: LinkingLike = {
      getInitialURL: async () => null,
      getLinkingURL: () => LINK,
      addEventListener: () => ({ remove: () => {} }),
    };
    await expect(sources(linking)).resolves.toEqual([TARGET]);
  });

  it("by default reads the link expo-linking kept (a link React Native's Linking lost)", async () => {
    mockKept.url = LINK;
    await expect(sources()).resolves.toEqual([TARGET]);
  });

  it("with no link, loads the game's start page", async () => {
    await expect(sources()).resolves.toEqual([config.gameUrl]);
  });

  it("a kept link that isn't the game's loads the start page", async () => {
    mockKept.url = "https://elsewhere.example/x";
    await expect(sources()).resolves.toEqual([config.gameUrl]);
  });
});
