import { createNativeBridge } from "@open-game-system/app-bridge-native";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { ShellWebView } from "../ShellWebView";

// BridgedWebView (app-bridge-react-native) is the real seam; it is replaced by a View that keeps
// its props so the test can fire the WebView's callbacks.
jest.mock("@open-game-system/app-bridge-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    BridgedWebView: (props: Record<string, unknown>) => {
      useEffect(() => {
        mockMounts.count += 1;
      }, []);
      return <View testID="bridged" {...props} />;
    },
  };
});

const mockMounts = { count: 0 };

type Stores = Record<string, never>;

function render(el: React.ReactElement) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(el);
  });
  return tree;
}

const webViewOf = (root: ReactTestInstance) =>
  root.find((n) => n.props.testID === "bridged" && typeof n.type !== "string");

describe("ShellWebView", () => {
  const bridge = createNativeBridge<Stores>();

  it("loads the URI on the given bridge with what games need from a WebView", () => {
    const tree = render(
      <ShellWebView bridge={bridge} uri="https://game.example/p" attempt={0} onStatus={() => {}} />,
    );
    const wv = webViewOf(tree.root);
    expect(wv.props.bridge).toBe(bridge);
    expect(wv.props.source).toEqual({ uri: "https://game.example/p" });
    expect(wv.props.javaScriptEnabled).toBe(true);
    expect(wv.props.domStorageEnabled).toBe(true);
    expect(wv.props.allowsInlineMediaPlayback).toBe(true);
    expect(wv.props.mediaPlaybackRequiresUserAction).toBe(false);
    expect(tree.root.findAll((n) => n.props.testID === "gameWebView").length).toBeGreaterThan(0);
  });

  it("reports LOADED on load and FAILED on error", () => {
    const onStatus = jest.fn();
    const tree = render(
      <ShellWebView bridge={bridge} uri="https://game.example/" attempt={0} onStatus={onStatus} />,
    );
    const wv = webViewOf(tree.root);
    act(() => wv.props.onLoad());
    act(() => wv.props.onError());
    expect(onStatus.mock.calls).toEqual([[{ type: "LOADED" }], [{ type: "FAILED" }]]);
  });

  it("reports FAILED when the game's page answers a server error (not a 4xx)", () => {
    const onStatus = jest.fn();
    const tree = render(
      <ShellWebView bridge={bridge} uri="https://game.example/" attempt={0} onStatus={onStatus} />,
    );
    const wv = webViewOf(tree.root);
    act(() =>
      wv.props.onHttpError({ nativeEvent: { statusCode: 404, url: "https://game.example/" } }),
    );
    act(() =>
      wv.props.onHttpError({ nativeEvent: { statusCode: 503, url: "https://game.example/" } }),
    );
    expect(onStatus.mock.calls).toEqual([[{ type: "FAILED" }]]);
  });

  it("tells where the game navigated", () => {
    const onNavigate = jest.fn();
    const tree = render(
      <ShellWebView
        bridge={bridge}
        uri="https://game.example/"
        attempt={0}
        onStatus={() => {}}
        onNavigate={onNavigate}
      />,
    );
    act(() =>
      webViewOf(tree.root).props.onNavigationStateChange({ url: "https://game.example/r/1" }),
    );
    expect(onNavigate).toHaveBeenCalledWith("https://game.example/r/1");
  });

  it("mounts a fresh WebView for each attempt", () => {
    const at = (attempt: number) => (
      <ShellWebView
        bridge={bridge}
        uri="https://game.example/"
        attempt={attempt}
        onStatus={() => {}}
      />
    );
    const tree = render(at(0));
    const before = mockMounts.count;
    act(() => tree.update(at(0)));
    expect(mockMounts.count).toBe(before);
    act(() => tree.update(at(1)));
    expect(mockMounts.count).toBe(before + 1);
  });
});
