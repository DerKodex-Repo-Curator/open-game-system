/**
 * opengame.org's `apple-app-site-association` and `assetlinks.json` (ADR 2026-10-18-multi-tenant-push):
 * the OGS app's own entries (as in apps/web/public/.well-known, a test keeps them equal) plus every
 * registered white-label app, each first for `/play/<appId>` and `/play/<appId>/*`. iOS uses the first
 * installed app whose paths match, so the OGS app stays the fallback for a game's links.
 */
export type AppLinks = {
  ios: { appId: string; appleAppId: string }[];
  android: { appId: string; package: string; sha256CertFingerprints: string[] }[];
};

export const OGS_AASA = {
  appID: "34S957HD77.org.opengame.app",
  paths: ["/open", "/open/*", "/play/*", "/join/*"],
};

export const OGS_ASSETLINKS = {
  relation: ["delegate_permission/common.handle_all_urls"],
  target: {
    namespace: "android_app",
    package_name: "org.opengame.app",
    sha256_cert_fingerprints: [
      "00:EF:59:A5:97:64:46:4F:AE:33:D3:3C:BF:17:26:B6:6B:A7:59:60:A3:3C:76:AF:B7:42:B6:0E:64:28:A7:63",
      "5E:8E:0B:C2:05:FB:89:21:A7:45:CF:1A:79:33:8A:6B:3F:F5:A7:D6:15:83:49:91:D6:31:9E:27:47:A0:6A:20",
    ],
  },
};

export function siteAssociation(links: AppLinks) {
  return {
    applinks: {
      apps: [] as string[],
      details: [
        ...links.ios.map((a) => ({
          appID: a.appleAppId,
          paths: [`/play/${a.appId}`, `/play/${a.appId}/*`],
        })),
        OGS_AASA,
      ],
    },
  };
}

export function assetlinks(links: AppLinks) {
  return [
    ...links.android.map((a) => ({
      relation: OGS_ASSETLINKS.relation,
      target: {
        namespace: "android_app",
        package_name: a.package,
        sha256_cert_fingerprints: a.sha256CertFingerprints,
      },
    })),
    OGS_ASSETLINKS,
  ];
}
