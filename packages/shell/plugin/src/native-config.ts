import type { ShellConfig } from "./shell-config";

/** The OGS Cast receiver (Google Cast app id) that loads the game's TV page. */
export const OGS_CAST_RECEIVER_APP_ID = "807AD5E9";
export const OGS_LINK_HOST = "opengame.org";

export type PluginEntry = string | [string, Record<string, unknown>];

export type IntentFilter = {
  action: "VIEW";
  autoVerify: true;
  data: { scheme: "https"; host: string; pathPrefix: string }[];
  category: ["BROWSABLE", "DEFAULT"];
};

export type NativeConfig = {
  icon?: string;
  ios: {
    associatedDomains: string[];
    usesAppleSignIn: true;
    infoPlist: { NSLocalNetworkUsageDescription: string; NSBonjourServices: string[] };
  };
  android: { intentFilters: IntentFilter[] };
  plugins: PluginEntry[];
  extra: {
    ogsShell: Pick<
      ShellConfig,
      "appId" | "gameUrl" | "branding" | "linkDomains" | "apiBase" | "tvBase"
    >;
  };
};

const viewFilter = (host: string, pathPrefix: string): IntentFilter => ({
  action: "VIEW",
  autoVerify: true,
  data: [{ scheme: "https", host, pathPrefix }],
  category: ["BROWSABLE", "DEFAULT"],
});

/**
 * The native config a shell app needs, from the developer's shell config. Pure: the Expo plugin merges
 * it into the app config. Never the developer's identity (bundle id, package, team, owner).
 */
export function nativeConfigFor(config: ShellConfig): NativeConfig {
  const ownDomains = config.linkDomains.filter((domain) => domain !== OGS_LINK_HOST);
  const iosDomains = [...new Set([...config.linkDomains, OGS_LINK_HOST])];
  const splashPlugin: PluginEntry = config.splash
    ? [
        "expo-splash-screen",
        {
          image: config.splash.image,
          ...(config.splash.backgroundColor
            ? { backgroundColor: config.splash.backgroundColor }
            : {}),
          imageWidth: 200,
          resizeMode: "contain",
        },
      ]
    : "expo-splash-screen";
  return {
    ...(config.icon ? { icon: config.icon } : {}),
    ios: {
      associatedDomains: iosDomains.map((domain) => `applinks:${domain}`),
      usesAppleSignIn: true,
      infoPlist: {
        NSLocalNetworkUsageDescription: `${config.name} looks for Chromecasts on your Wi-Fi so you can play on your TV.`,
        NSBonjourServices: ["_googlecast._tcp"],
      },
    },
    android: {
      intentFilters: [
        ...ownDomains.map((domain) => viewFilter(domain, "/")),
        viewFilter(OGS_LINK_HOST, `/play/${config.appId}`),
      ],
    },
    plugins: [
      [
        "react-native-google-cast",
        {
          receiverAppId: OGS_CAST_RECEIVER_APP_ID,
          iosStartDiscoveryAfterFirstTapOnCastButton: false,
        },
      ],
      "expo-notifications",
      "expo-apple-authentication",
      splashPlugin,
    ],
    extra: {
      ogsShell: {
        appId: config.appId,
        gameUrl: config.gameUrl,
        branding: config.branding,
        linkDomains: config.linkDomains,
        ...(config.apiBase ? { apiBase: config.apiBase } : {}),
        ...(config.tvBase ? { tvBase: config.tvBase } : {}),
      },
    },
  };
}
