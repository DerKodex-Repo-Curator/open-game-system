import { act, create, type ReactTestInstance } from "react-test-renderer";
import type { SignInState } from "../native-sign-in";
import { SignInSheet, type SignInSheetProps } from "../SignInSheet";

function render(over: Partial<SignInSheetProps> = {}) {
  const props: SignInSheetProps = {
    visible: true,
    gameName: "Rocket Crew",
    providers: ["apple"],
    state: { status: "idle" },
    onSignIn: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<SignInSheet {...props} />);
  });
  return { root: tree.root, props };
}

const byId = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function");
const textOf = (root: ReactTestInstance) =>
  root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => n.children.filter((c) => typeof c === "string").join(""));

describe("SignInSheet", () => {
  it("offers Sign in with Apple and signs in on tap", () => {
    const { root, props } = render();
    expect(textOf(root)).toContain("Sign in with Apple");
    expect(byId(root, "signInGoogle")).toHaveLength(0);
    const [apple] = byId(root, "signInApple");
    act(() => apple?.props.onPress());
    expect(props.onSignIn).toHaveBeenCalledWith("apple");
  });

  it("offers Google when the platform has it", () => {
    const { root, props } = render({ providers: ["google"] });
    expect(byId(root, "signInApple")).toHaveLength(0);
    const [google] = byId(root, "signInGoogle");
    act(() => google?.props.onPress());
    expect(props.onSignIn).toHaveBeenCalledWith("google");
  });

  it("names the game", () => {
    const { root } = render();
    expect(textOf(root).some((t) => t.includes("Rocket Crew"))).toBe(true);
  });

  it("closes with Not now", () => {
    const { root, props } = render();
    const [notNow] = byId(root, "signInNotNow");
    act(() => notNow?.props.onPress());
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons and shows progress while signing in", () => {
    const state: SignInState = { status: "signing-in", provider: "apple" };
    const { root, props } = render({ state });
    const [apple] = byId(root, "signInApple");
    expect(apple?.props.disabled).toBe(true);
    expect(root.findAll((n) => n.props.testID === "signInProgress").length).toBeGreaterThan(0);
    act(() => apple?.props.onPress());
    expect(props.onSignIn).not.toHaveBeenCalled();
  });

  it("says when sign-in failed, and not when it was cancelled", () => {
    const failed = render({ state: { status: "error", code: "invalid_token" } });
    expect(failed.root.findAll((n) => n.props.testID === "signInError").length).toBeGreaterThan(0);
    const cancelled = render({ state: { status: "cancelled" } });
    expect(cancelled.root.findAll((n) => n.props.testID === "signInError")).toHaveLength(0);
  });

  it("renders nothing when not visible", () => {
    const { root } = render({ visible: false });
    expect(byId(root, "signInApple")).toHaveLength(0);
  });
});
