import { createNativeBridge } from "@open-game-system/app-bridge-native";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { CastPickerSheet, type CastPickerSheetProps } from "../CastPickerSheet";
import type { CastPickerState } from "../cast-picker";
import type { CastDevice } from "../cast-store";
import { DEFAULT_OFFLINE_THEME, OfflineScreen } from "../OfflineScreen";
import { ShellWebView } from "../ShellWebView";
import { SignInSheet, type SignInSheetProps } from "../SignInSheet";

// The native sheets and screens exactly as they render (layout, colors, words): a snapshot per
// state, plus the behaviours the other suites leave open.

jest.mock("@open-game-system/app-bridge-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BridgedWebView: (props: Record<string, unknown>) => <View testID="bridged" {...props} />,
  };
});

function mount(el: React.ReactElement) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(el);
  });
  return tree;
}

const TV: CastDevice = { id: "tv-1", name: "Living Room TV", type: "chromecast" };

function picker(state: Partial<CastPickerState>) {
  const props: CastPickerSheetProps = {
    state: { visible: true, devices: [TV], browserTv: null, ...state },
    onPick: jest.fn(),
    onOpenBrowserTv: jest.fn(),
    onPair: jest.fn(),
    onClose: jest.fn(),
  };
  return { tree: mount(<CastPickerSheet {...props} />), props };
}

const one = (root: ReactTestInstance, id: string) => {
  const [node] = root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
  if (!node) throw new Error(`no ${id}`);
  return node;
};
const tv = (over: Partial<NonNullable<CastPickerState["browserTv"]>> = {}) => ({
  open: true,
  address: "ogs-tv.pages.dev",
  pairing: false,
  error: null,
  ...over,
});

describe("CastPickerSheet renders", () => {
  it("devices and the browser TV button", () => {
    const { tree } = picker({ browserTv: tv({ open: false }) });
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it("no devices", () => {
    expect(picker({ devices: [] }).tree.toJSON()).toMatchSnapshot();
  });

  it("the pairing panel: empty, busy with an error", () => {
    expect(picker({ browserTv: tv() }).tree.toJSON()).toMatchSnapshot();
    expect(
      picker({
        browserTv: tv({ pairing: true, error: "That code isn't showing on a TV" }),
      }).tree.toJSON(),
    ).toMatchSnapshot();
  });

  it("a full code enables Pair", () => {
    const { tree } = picker({ browserTv: tv() });
    act(() => one(tree.root, "browserTvCode").props.onChangeText("abc123"));
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it("a code padded with spaces to six characters can't be sent", () => {
    const { tree, props } = picker({ browserTv: tv() });
    act(() => one(tree.root, "browserTvCode").props.onChangeText("abc12 "));
    act(() => one(tree.root, "browserTvCode").props.onSubmitEditing());
    expect(props.onPair).not.toHaveBeenCalled();
    expect(one(tree.root, "browserTvPair").props.disabled).toBe(true);
  });

  it("submitting a short code from the keyboard sends nothing", () => {
    const { tree, props } = picker({ browserTv: tv() });
    act(() => one(tree.root, "browserTvCode").props.onChangeText("abc"));
    act(() => one(tree.root, "browserTvCode").props.onSubmitEditing());
    expect(props.onPair).not.toHaveBeenCalled();
  });
});

function signIn(over: Partial<SignInSheetProps>) {
  const props: SignInSheetProps = {
    visible: true,
    gameName: "Rocket Crew",
    providers: ["apple", "google"],
    state: { status: "idle" },
    onSignIn: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
  return mount(<SignInSheet {...props} />);
}

describe("SignInSheet renders", () => {
  it("Apple and Google, idle", () => {
    expect(signIn({}).toJSON()).toMatchSnapshot();
  });

  it("busy", () => {
    expect(
      signIn({ state: { status: "signing-in", provider: "google" } }).toJSON(),
    ).toMatchSnapshot();
  });

  it("an error", () => {
    expect(signIn({ state: { status: "error", code: "FAILED" } }).toJSON()).toMatchSnapshot();
  });
});

describe("OfflineScreen renders", () => {
  it("in the default theme", () => {
    expect(DEFAULT_OFFLINE_THEME).toMatchSnapshot();
    expect(
      mount(<OfflineScreen gameName="Rocket Crew" onRetry={() => {}} />).toJSON(),
    ).toMatchSnapshot();
  });
});

describe("ShellWebView", () => {
  const bridge = createNativeBridge<Record<string, never>>();
  const render = (onStatus: jest.Mock, onNavigate?: (url: string) => void) =>
    mount(
      <ShellWebView
        bridge={bridge}
        uri="https://play.rocketcrew.tv/"
        attempt={0}
        onStatus={onStatus}
        userAgentName="OgsShell/rocket-crew"
        {...(onNavigate ? { onNavigate } : {})}
      />,
    );

  it("renders the WebView as games need it", () => {
    expect(render(jest.fn()).toJSON()).toMatchSnapshot();
  });

  it("a 500 is a failure, a 499 is not", () => {
    const onStatus = jest.fn();
    const wv = one(render(onStatus).root, "bridged");
    act(() => wv.props.onHttpError({ nativeEvent: { statusCode: 499 } }));
    expect(onStatus).not.toHaveBeenCalled();
    act(() => wv.props.onHttpError({ nativeEvent: { statusCode: 500 } }));
    expect(onStatus).toHaveBeenCalledWith({ type: "FAILED" });
  });

  it("navigating without an onNavigate listener is fine", () => {
    const wv = one(render(jest.fn()).root, "bridged");
    expect(() =>
      act(() => wv.props.onNavigationStateChange({ url: "https://play.rocketcrew.tv/x" })),
    ).not.toThrow();
  });
});
