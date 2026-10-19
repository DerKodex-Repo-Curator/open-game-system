import { existsSync } from "node:fs";
import type { ShellConfigInput } from "@open-game-system/shell/plugin";
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * What the @open-game-system/shell plugin needs. It adds casting (Google Cast), push, links
 * (__OGS_LINK_BASE__ and opengame.org/play/__OGS_APP_ID__), native sign-in and the splash, and passes this to
 * <OgsShell /> at run time (Constants.expoConfig.extra.ogsShell). The plugin checks it at prebuild.
 */
const shell = {
  /** Your game's id in the OGS catalogue. */
  appId: "__OGS_APP_ID__",
  name: "__OGS_APP_NAME__",
  /** The phone page the app opens. Deploy the web game and the app updates, no store release. */
  gameUrl: "__OGS_GAME_URL__",
  icon: "./assets/icon.png",
  splash: { image: "./assets/splash-icon.png", backgroundColor: "__OGS_BRAND_COLOR__" },
  /** "hidden": OGS never shows. "powered-by": a small "Powered by OGS" mark. */
  branding: "__OGS_BRANDING__",
  /** Your own link domains (serve link-files/.well-known/ there). opengame.org is always on. */
  linkDomains: __OGS_LINK_DOMAINS__,
  /** The TV shows your manifest's tvUrl full screen on the OGS Cast receiver. */
  cast: { receiver: "ogs" },
  // A test build can point at a preview OGS API and TV launcher (production when left out):
  // apiBase: "https://opengame-api-pr-123.example.workers.dev", tvBase: "https://…",
} satisfies ShellConfigInput;

/** Android push needs your Firebase app's config (README: "Push"). Not a secret: commit it. */
const GOOGLE_SERVICES = "./google-services.json";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: shell.name,
  slug: shell.appId,
  scheme: shell.appId,
  version: "1.0.0",
  orientation: "default",
  icon: shell.icon,
  userInterfaceStyle: "automatic",
  // The plugin never sets these: they are yours.
  ios: {
    bundleIdentifier: "__OGS_BUNDLE_ID__",
    // developer.apple.com → Membership. The simulator doesn't need it; a real phone and the stores do.
    appleTeamId: "__OGS_APPLE_TEAM_ID__",
    supportsTablet: true,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: "__OGS_ANDROID_PACKAGE__",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "__OGS_BRAND_COLOR__",
    },
    ...(existsSync(GOOGLE_SERVICES) ? { googleServicesFile: GOOGLE_SERVICES } : {}),
  },
  plugins: ["expo-router", ["@open-game-system/shell", shell]],
});
