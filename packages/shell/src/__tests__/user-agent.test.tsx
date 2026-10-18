import { createNativeBridge } from "@open-game-system/app-bridge-native";
import { act, create } from "react-test-renderer";
import { ShellWebView } from "../ShellWebView";
import { shellUserAgentName } from "../user-agent";

jest.mock("@open-game-system/app-bridge-react-native", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BridgedWebView: (props: Record<string, unknown>) => <View testID="bridged" {...props} />,
  };
});

describe("the game's in-app signal (user agent)", () => {
  it("names the shell and the game: OgsShell/<appId>", () => {
    expect(shellUserAgentName("rocket-crew")).toBe("OgsShell/rocket-crew");
  });

  it("ShellWebView appends it to the WebView's user agent", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ShellWebView
          bridge={createNativeBridge<Record<string, never>>()}
          uri="https://game.example/"
          attempt={0}
          onStatus={() => {}}
          userAgentName="OgsShell/rocket-crew"
        />,
      );
    });
    const wv = tree.root.find((n) => n.props.testID === "bridged" && typeof n.type !== "string");
    expect(wv.props.applicationNameForUserAgent).toBe("OgsShell/rocket-crew");
  });
});
