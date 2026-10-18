import { Platform, Settings } from "react-native";
import { clockOffset, shiftClock } from "./e2e-clock";

// Imported first by the root layout. Inert unless the build sets EXPO_PUBLIC_E2E_CLOCK=1 (an e2e
// build): then Detox's launch argument ogsClockOffsetMs moves the clock (iOS reads it through
// NSUserDefaults, which Settings exposes).
if (process.env.EXPO_PUBLIC_E2E_CLOCK === "1" && Platform.OS === "ios") {
  shiftClock(clockOffset(Settings.get("ogsClockOffsetMs")));
}
