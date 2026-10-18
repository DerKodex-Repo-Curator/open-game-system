import * as Haptics from "expo-haptics";
import { expoHapticsPlayer } from "../expo-haptics-player";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

describe("expoHapticsPlayer", () => {
  it("maps each style and kind to expo-haptics", async () => {
    const player = expoHapticsPlayer();
    await player.impact("light");
    await player.impact("medium");
    await player.impact("heavy");
    await player.notify("success");
    await player.notify("warning");
    await player.notify("error");
    expect(jest.mocked(Haptics.impactAsync).mock.calls).toEqual([["light"], ["medium"], ["heavy"]]);
    expect(jest.mocked(Haptics.notificationAsync).mock.calls).toEqual([
      ["success"],
      ["warning"],
      ["error"],
    ]);
  });
});
