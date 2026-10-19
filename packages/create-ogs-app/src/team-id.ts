import type { PlaceholderValues } from "./placeholders";

/**
 * A developer can make the app before they have an Apple Developer account (the simulator needs
 * none). Then the config files leave the Team ID empty (Expo and EAS skip it) and the text files
 * show this blank to fill in.
 */
export const TEAM_ID_BLANK = "<TEAM_ID>";

/** Files that take the Team ID as a setting: empty stays empty there. */
const CONFIG_FILES = new Set(["app.config.ts", "eas.json"]);

/** The Team ID as text for people: the blank when there is none yet. */
export const teamIdText = (teamId: string) => teamId || TEAM_ID_BLANK;

/** The placeholder values for one file of the new app. */
export function valuesForFile(to: string, values: PlaceholderValues): PlaceholderValues {
  if (CONFIG_FILES.has(to)) return values;
  return { ...values, APPLE_TEAM_ID: teamIdText(values.APPLE_TEAM_ID) };
}

/** eas.json's `"ios": { "appleTeamId": "" }` entries go: an empty Team ID is not a setting. */
export function withoutEmptyTeamIds(easJson: string): string {
  return easJson.replace(/^[ \t]*"ios": \{ "appleTeamId": "" \},?\r?\n/gm, "");
}
