import type { Answers } from "./options";

/**
 * Template files name their blanks `__OGS_<NAME>__`: unlike `{{name}}`, it never collides with JSX
 * (`style={{ … }}`) or Markdown, and a leftover one is easy to find.
 */
export const PLACEHOLDER_NAMES = [
  "APP_ID",
  "APP_NAME",
  "GAME_URL",
  "GAME_ORIGIN",
  "BUNDLE_ID",
  "ANDROID_PACKAGE",
  "APPLE_TEAM_ID",
  "LINK_DOMAINS",
  "LINK_BASE",
  "BRANDING",
  "SHELL_VERSION",
  "BRAND_COLOR",
] as const;

export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];
export type PlaceholderValues = Record<PlaceholderName, string>;

const PLACEHOLDER = /__OGS_([A-Z0-9_]+?)__/g;

const isPlaceholderName = (name: string): name is PlaceholderName =>
  PLACEHOLDER_NAMES.some((known) => known === name);

/** A stable, darkish brand color per app id, for the generated icon and splash. */
export function brandColor(appId: string): string {
  let hash = 0;
  for (const ch of appId) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return hslToHex(hash % 360, 0.55, 0.36);
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function placeholderValues(a: Answers): PlaceholderValues {
  const [firstDomain] = a.linkDomains;
  return {
    APP_ID: a.appId,
    APP_NAME: a.name,
    GAME_URL: a.gameUrl,
    GAME_ORIGIN: new URL(a.gameUrl).origin,
    BUNDLE_ID: a.bundleId,
    ANDROID_PACKAGE: a.androidPackage,
    APPLE_TEAM_ID: a.teamId,
    LINK_DOMAINS: `[${a.linkDomains.map((d) => JSON.stringify(d)).join(", ")}]`,
    LINK_BASE: firstDomain ? `https://${firstDomain}` : `https://opengame.org/play/${a.appId}`,
    BRANDING: a.branding,
    SHELL_VERSION: a.shellVersion,
    BRAND_COLOR: brandColor(a.appId),
  };
}

/** Fills every `__OGS_<NAME>__`; an unknown name is a bug in the template, so it throws. */
export function renderTemplate(text: string, values: PlaceholderValues): string {
  const unknown = findPlaceholders(text).filter((token) => !isPlaceholderName(token.slice(6, -2)));
  if (unknown.length > 0) throw new Error(`unknown template placeholder ${unknown.join(", ")}`);
  return text.replace(PLACEHOLDER, (token, name: string) =>
    isPlaceholderName(name) ? values[name] : token,
  );
}

/** The distinct `__OGS_<NAME>__` tokens in a text, in order of first appearance. */
export function findPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[0]))];
}
