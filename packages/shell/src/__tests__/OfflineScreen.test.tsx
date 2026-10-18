import { act, create, type ReactTestInstance } from "react-test-renderer";
import { DEFAULT_OFFLINE_THEME, OfflineScreen } from "../OfflineScreen";

function texts(root: ReactTestInstance): string[] {
  return root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.filter((c) => typeof c === "string").join(""));
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style: unknown = node.props.style;
  const list = Array.isArray(style) ? style : [style];
  return Object.assign({}, ...list.filter((s) => s && typeof s === "object"));
}

describe("OfflineScreen", () => {
  it("names the game and retries on tap (testIDs kept from the OGS app)", () => {
    const onRetry = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<OfflineScreen gameName="Rocket Crew" onRetry={onRetry} />);
    });
    const root = tree.root;
    expect(root.findAll((n) => n.props.testID === "gameErrorScreen").length).toBeGreaterThan(0);
    expect(texts(root)).toContain("Can't reach Rocket Crew");
    const button = root.find(
      (n) => n.props.testID === "gameRetryButton" && typeof n.props.onPress === "function",
    );
    act(() => button.props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses the default theme", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<OfflineScreen gameName="X" onRetry={() => {}} />);
    });
    const screen = tree.root.find(
      (n) => n.props.testID === "gameErrorScreen" && typeof n.type === "string",
    );
    expect(styleOf(screen).backgroundColor).toBe(DEFAULT_OFFLINE_THEME.background);
  });

  it("takes colors from the shell config's theme", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <OfflineScreen
          gameName="X"
          onRetry={() => {}}
          theme={{ background: "#101820", accent: "#FF7A00" }}
        />,
      );
    });
    const screen = tree.root.find(
      (n) => n.props.testID === "gameErrorScreen" && typeof n.type === "string",
    );
    expect(styleOf(screen).backgroundColor).toBe("#101820");
    const button = tree.root.find(
      (n) => n.props.testID === "gameRetryButton" && typeof n.type === "string",
    );
    expect(styleOf(button).backgroundColor).toBe("#FF7A00");
    const title = tree.root.find(
      (n) => n.props.testID === "gameErrorTitle" && typeof n.type === "string",
    );
    expect(styleOf(title).color).toBe(DEFAULT_OFFLINE_THEME.text);
  });
});
