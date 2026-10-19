import { act, create, type ReactTestInstance } from "react-test-renderer";
import { CastPickerSheet, type CastPickerSheetProps } from "../CastPickerSheet";
import type { CastPickerState } from "../cast-picker";

const TV = { id: "tv-1", name: "Living Room TV", type: "chromecast" as const };
const closedTv = { open: false, address: "ogs-tv.pages.dev", pairing: false, error: null };

function render(state: Partial<CastPickerState> = {}) {
  const props: CastPickerSheetProps = {
    state: { visible: true, devices: [TV], browserTv: closedTv, ...state },
    onPick: jest.fn(),
    onOpenBrowserTv: jest.fn(),
    onPair: jest.fn(),
    onClose: jest.fn(),
  };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<CastPickerSheet {...props} />);
  });
  return { root: tree.root, props, tree };
}

const pressable = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function");
const byId = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
const texts = (root: ReactTestInstance) =>
  root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.filter((c) => typeof c === "string").join(""));

describe("CastPickerSheet", () => {
  it("lists the Chromecasts found; a tap picks one", () => {
    const { root, props } = render();
    expect(texts(root)).toContain("Living Room TV");
    const [tv] = pressable(root, "castPickerDevice-tv-1");
    expect(tv?.props.accessibilityLabel).toBe("Living Room TV");
    act(() => tv?.props.onPress());
    expect(props.onPick).toHaveBeenCalledWith("tv-1");
  });

  it("says when no Chromecast is found, and still offers a browser TV", () => {
    const { root, props } = render({ devices: [] });
    expect(byId(root, "castPickerNoDevices").length).toBeGreaterThan(0);
    const [open] = pressable(root, "browserTvOpen");
    expect(open?.props.accessibilityLabel).toBe("Use a browser TV");
    act(() => open?.props.onPress());
    expect(props.onOpenBrowserTv).toHaveBeenCalled();
  });

  it("the browser TV panel names the TV address and pairs the typed code", () => {
    const { root, props } = render({ browserTv: { ...closedTv, open: true } });
    expect(pressable(root, "browserTvOpen")).toHaveLength(0);
    expect(byId(root, "browserTv").length).toBeGreaterThan(0);
    const address = root.findAll((n) => n.props.testID === "browserTvAddress");
    expect(address.length).toBeGreaterThan(0);
    expect(texts(root)).toContain("ogs-tv.pages.dev");
    const [input] = root.findAll(
      (n) => n.props.testID === "browserTvCode" && typeof n.props.onChangeText === "function",
    );
    expect(input?.props.accessibilityLabel).toBe("Code on the TV");
    const [pairButton] = pressable(root, "browserTvPair");
    expect(pairButton?.props.disabled).toBe(true);
    act(() => input?.props.onChangeText("kqtp7x"));
    const [enabled] = pressable(root, "browserTvPair");
    expect(enabled?.props.disabled).toBe(false);
    act(() => enabled?.props.onPress());
    expect(props.onPair).toHaveBeenCalledWith("KQTP7X");
  });

  it("shows the pairing error and a busy Pair button", () => {
    const { root } = render({
      browserTv: { ...closedTv, open: true, pairing: true, error: "No TV shows that code." },
    });
    expect(texts(root)).toContain("No TV shows that code.");
    expect(byId(root, "browserTvPairing").length).toBeGreaterThan(0);
  });

  it("offers no browser TV when the app has none", () => {
    const { root } = render({ browserTv: null });
    expect(pressable(root, "browserTvOpen")).toHaveLength(0);
  });

  it("Not now closes", () => {
    const { root, props } = render();
    const [close] = pressable(root, "castPickerClose");
    act(() => close?.props.onPress());
    expect(props.onClose).toHaveBeenCalled();
  });
});
