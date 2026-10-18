import { OgsShell } from "@open-game-system/shell";

/**
 * The whole app: your game's phone page in a WebView with the OGS app bridge, so the page gets
 * casting, the player's profile, push and haptics, plus a native sign-in sheet, push prompt and
 * offline screen. Settings come from app.config.ts.
 */
export default function Game() {
  return <OgsShell />;
}
