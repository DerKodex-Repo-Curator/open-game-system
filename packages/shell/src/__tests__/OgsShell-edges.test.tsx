import { act, create, type ReactTestInstance } from "react-test-renderer";
import { fakeFetch } from "../__fixtures__/fake-fetch";
import { fakeStorage } from "../__fixtures__/fake-storage";
import type { CastDevice } from "../cast-store";
import { defaultShellDeps } from "../default-deps";
import { type LinkingLike, OgsShell } from "../OgsShell";
import type { OgsShellConfig } from "../runtime-config";
import { createShellRuntime, type ShellRuntimeDeps } from "../shell-runtime";
import type { AppleAuthModule } from "../sign-in-providers";
import type { AppStateLike } from "../webview-status";

jest.mock("@open-game-system/app-bridge-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BridgedWebView: (props: Record<string, unknown>) => <View testID="bridged" {...props} />,
  };
});
jest.mock("../default-deps", () => ({ defaultShellDeps: jest.fn() }));

const config: OgsShellConfig = {
  appId: "rocket-crew",
  gameUrl: "https://play.rocketcrew.tv/phone",
  name: "Rocket Crew",
  apiBase: "https://api.test",
  linkDomains: [],
  branding: "powered-by",
};
const TV: CastDevice = { id: "tv-1", name: "Living Room TV", type: "chromecast" };

function deps(): ShellRuntimeDeps {
  const net = fakeFetch({
    "POST /api/v1/profiles": () => ({
      status: 201,
      body: {
        profile: { id: "g", handle: "player", name: "Player", sticker: "owl" },
        token: "guest",
      },
    }),
  });
  return {
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
        signIn: async () => ({ status: "cancelled" }),
      },
    ],
  };
}

function linkingWith() {
  const listeners = new Set<(e: { url: string }) => void>();
  const linking: LinkingLike = {
    getInitialURL: async () => null,
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

function appStateWith() {
  const listeners = new Set<(s: string) => void>();
  const appState: AppStateLike = {
    currentState: "active",
    addEventListener: (_t, l) => {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    },
  };
  return {
    appState,
    go: (s: string) => {
      for (const l of listeners) l(s);
    },
    count: () => listeners.size,
  };
}

const byId = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function");
const host = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
const press = async (root: ReactTestInstance, id: string) => {
  const [node] = byId(root, id);
  if (!node) throw new Error(`no ${id}`);
  await act(async () => {
    node.props.onPress();
  });
};

const noTaps = {
  getLastNotificationResponse: () => null,
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
};

jest.setTimeout(30000);
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function render(over: { theme?: { background: string; text: string; muted: string } } = {}) {
  const runtime = createShellRuntime(config, deps());
  const links = linkingWith();
  const app = appStateWith();
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <OgsShell
        config={config}
        runtime={runtime}
        linking={links.linking}
        appState={app.appState}
        pushTaps={noTaps}
        {...(over.theme ? { theme: over.theme } : {})}
      />,
    );
  });
  await act(async () => {
    await runtime.idle();
  });
  return { tree, runtime, links, app };
}

describe("<OgsShell />, edges", () => {
  it("the loading screen in the app's theme, Powered by OGS in its muted color", async () => {
    const { tree } = await render({
      theme: { background: "#101010", text: "#FAFAFA", muted: "#777777" },
    });
    expect(host(tree.root, "shellLoading")[0]?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: "#101010" })]),
    );
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it("the offline screen keeps Powered by OGS", async () => {
    const { tree } = await render();
    await act(async () => {
      host(tree.root, "bridged")[0]?.props.onError();
    });
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it("Not now closes the sign-in sheet", async () => {
    const { tree, runtime } = await render();
    await act(async () => {
      await runtime.openSignIn();
    });
    expect(runtime.sheet.getSnapshot().visible).toBe(true);
    await press(tree.root, "signInNotNow");
    expect(runtime.sheet.getSnapshot().visible).toBe(false);
  });

  it("the TV picker's buttons reach the runtime's picker", async () => {
    const { tree, runtime } = await render();
    const cast = jest.fn();
    act(() => {
      runtime.castPicker.attach({
        getDevices: () => [TV],
        subscribeDevices: () => () => {},
        cast,
        tvAddress: "ogs-tv.pages.dev",
      });
      runtime.castPicker.open();
    });
    await press(tree.root, `castPickerDevice-${TV.id}`);
    expect(cast).toHaveBeenCalledWith(TV.id);
    act(() => runtime.castPicker.open());
    await press(tree.root, "castPickerClose");
    expect(runtime.castPicker.getSnapshot().visible).toBe(false);
  });

  it("follows a new appState or linking given on a later render", async () => {
    const { tree, runtime } = await render();
    const links = linkingWith();
    const app = appStateWith();
    await act(async () => {
      tree.update(
        <OgsShell
          config={config}
          runtime={runtime}
          linking={links.linking}
          appState={app.appState}
          pushTaps={noTaps}
        />,
      );
    });
    expect(app.count()).toBe(1);
    await act(async () => {
      links.open("https://play.rocketcrew.tv/room/9");
    });
    expect(host(tree.root, "bridged")[0]?.props.source).toEqual({
      uri: "https://play.rocketcrew.tv/room/9",
    });
  });

  it("without a runtime, makes one from the device defaults (with Sign in with Apple) and the app's deps", async () => {
    const apple: AppleAuthModule = {
      AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
      isAvailableAsync: async () => true,
      signInAsync: async () => ({ identityToken: "jwt" }),
    };
    const base = deps();
    jest
      .mocked(defaultShellDeps)
      .mockReturnValue({ ...base, haptics: { impact: jest.fn(), notify: jest.fn() } });
    const impact = jest.fn(async () => {});
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <OgsShell
          config={config}
          appleAuthentication={apple}
          deps={{ haptics: { impact, notify: async () => {} } }}
          linking={linkingWith().linking}
          appState={appStateWith().appState}
          pushTaps={noTaps}
        />,
      );
    });
    expect(defaultShellDeps).toHaveBeenCalledWith(config, { appleAuthentication: apple });
    const [wv] = host(tree.root, "bridged");
    await act(async () => {
      wv?.props.bridge.handleWebMessage(
        JSON.stringify({
          type: "EVENT",
          storeKey: "haptics",
          event: { type: "IMPACT", style: "light" },
        }),
      );
    });
    expect(impact).toHaveBeenCalledWith("light");
    act(() => tree.unmount());
  });
});
