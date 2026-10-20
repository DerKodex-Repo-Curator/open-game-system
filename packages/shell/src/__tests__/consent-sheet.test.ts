import { Alert, type AlertButton } from "react-native";
import { askToNotify } from "../consent-sheet";

type AlertArgs = Parameters<typeof Alert.alert>;

function shown(): { args: AlertArgs; buttons: AlertButton[] } {
  const spy = jest.mocked(Alert.alert);
  const args = spy.mock.calls.at(-1);
  if (!args) throw new Error("no alert shown");
  return { args, buttons: args[2] ?? [] };
}

describe("askToNotify", () => {
  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("asks with the game's name: Not now (cancel) or Allow, dismissable", () => {
    void askToNotify("Rocket Crew");
    const { args, buttons } = shown();
    expect(args[0]).toBe("Let Rocket Crew notify you?");
    expect(args[1]).toBe(
      "Only when something needs you, like your turn. You can turn it off in Settings.",
    );
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ["Not now", "cancel"],
      ["Allow", undefined],
    ]);
    expect(args[3]).toEqual(expect.objectContaining({ cancelable: true }));
  });

  it("Allow answers true", async () => {
    const answer = askToNotify("Rocket Crew");
    shown().buttons[1]?.onPress?.();
    await expect(answer).resolves.toBe(true);
  });

  it("Not now answers false", async () => {
    const answer = askToNotify("Rocket Crew");
    shown().buttons[0]?.onPress?.();
    await expect(answer).resolves.toBe(false);
  });

  it("dismissing the sheet answers false", async () => {
    const answer = askToNotify("Rocket Crew");
    shown().args[3]?.onDismiss?.();
    await expect(answer).resolves.toBe(false);
  });
});
