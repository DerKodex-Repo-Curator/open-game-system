/** Why no TV shows up, most likely first: the TV tab's No TV found and the cast prompt both say it. */
export const NO_TV_CAUSES: ReadonlyArray<readonly [title: string, body: string]> = [
  ["Local Network is off for OGS", "Settings › OGS › Local Network lets OGS see your Chromecast."],
  ["Different Wi-Fi", "Your phone and the TV need to be on the same Wi-Fi."],
  ["The TV is asleep", "Turn the TV on and switch to the Chromecast's input."],
];

/** The causes for this phone: Android has no Local Network switch (it's iOS's). */
export function noTvCauses(os: string): typeof NO_TV_CAUSES {
  return os === "ios" ? NO_TV_CAUSES : NO_TV_CAUSES.slice(1);
}
