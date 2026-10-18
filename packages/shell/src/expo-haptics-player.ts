import * as Haptics from "expo-haptics";
import type { HapticsPlayer } from "./haptics-store";

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};
const NOTIFY = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

/** The haptics store's player on a real device: expo-haptics. */
export function expoHapticsPlayer(): HapticsPlayer {
  return {
    impact: (style) => Haptics.impactAsync(IMPACT[style]),
    notify: (kind) => Haptics.notificationAsync(NOTIFY[kind]),
  };
}
