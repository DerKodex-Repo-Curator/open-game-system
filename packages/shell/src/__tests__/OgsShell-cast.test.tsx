import { act, create, type ReactTestInstance } from "react-test-renderer";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import { castGameStores } from "../cast-stores";
import { createFakeCastBackend } from "../fake-cast";
import { type LinkingLike, OgsShell } from "../OgsShell";
import type { OgsShellConfig } from "../runtime-config";
import { createShellRuntime } from "../shell-runtime";

jest.mock("@open-game-system/app-bridge-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BridgedWebView: (props: Record<string, unknown>) => <View testID="bridged" {...props} />,
  };
});
jest.mock("../default-deps", () => ({ defaultShellDeps: () => ({}) }));
jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

// Acceptance: 2026-10-18-shell-device-gaps.feature, "A browser TV pairs by code and shows the game".
const config: OgsShellConfig = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: [],
  branding: "hidden",
};

const linking: LinkingLike = {
  getInitialURL: async () => null,
  addEventListener: () => ({ remove: () => {} }),
};
const appState = { currentState: "active", addEventListener: () => ({ remove: () => {} }) };

function makeRuntime() {
  const net = fakeFetch({
    "POST /api/v1/profiles": () => ({
      status: 201,
      body: {
        profile: { id: "g", handle: "player", name: "Player", sticker: "owl" },
        token: "guest",
      },
    }),
    "POST /api/v1/sessions": () => ({ status: 201, body: { sessionId: "s", token: "launcher" } }),
    "POST /api/v1/screens/claim": () => ({
      status: 200,
      body: { screenId: "sc1", name: "Browser TV" },
    }),
    "POST /api/v1/screens/sc1/show": () => ({ status: 204 }),
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
    signInProviders: [],
    gameStores: castGameStores(
      createFakeCastBackend({ mode: "none", loadUrl: "https://fake.test/load", fetch: net.fetch }),
      { streamServerUrl: "https://stream.test" },
    ),
  });
  return { runtime, calls: net.calls };
}

const find = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
const press = (root: ReactTestInstance, id: string) => {
  const [node] = root.findAll(
    (n) => n.props.testID === id && typeof n.props.onPress === "function",
  );
  if (!node) throw new Error(`nothing to press: ${id}`);
  node.props.onPress();
};
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
};

jest.setTimeout(30000);
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("<OgsShell /> casting with no Chromecast", () => {
  it("the game's cast button opens the native picker; a browser TV pairs and is cast to", async () => {
    const { runtime, calls } = makeRuntime();
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <OgsShell config={config} runtime={runtime} linking={linking} appState={appState} />,
      );
    });
    await act(async () => {
      await runtime.idle();
    });
    expect(find(tree.root, "castPicker")).toHaveLength(0);

    await act(async () => {
      runtime.bridge.handleWebMessage(
        JSON.stringify({ type: "EVENT", storeKey: "cast", event: { type: "SHOW_CAST_PICKER" } }),
      );
    });
    expect(find(tree.root, "castPicker").length).toBeGreaterThan(0);
    expect(find(tree.root, "castPickerNoDevices").length).toBeGreaterThan(0);

    act(() => press(tree.root, "browserTvOpen"));
    const address = tree.root.findAll(
      (n) => n.props.testID === "browserTvAddress" && n.children.includes("ogs-tv.pages.dev"),
    );
    expect(address.length).toBeGreaterThan(0);
    const [input] = tree.root.findAll(
      (n) => n.props.testID === "browserTvCode" && typeof n.props.onChangeText === "function",
    );
    act(() => input?.props.onChangeText("KQTP7X"));
    await act(async () => {
      press(tree.root, "browserTvPair");
      await until(() => calls.some((c) => c.url.endsWith("/screens/sc1/show")));
    });
    expect(calls.find((c) => c.url.endsWith("/screens/sc1/show"))?.body).toEqual({
      token: "launcher",
      app: "rocket-crew",
    });
    expect(find(tree.root, "castPicker")).toHaveLength(0);
  });
});
