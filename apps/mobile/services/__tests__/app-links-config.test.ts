import appJson from "../../app.json";

/**
 * Game links open the app (docs/acceptance/2026-10-07-game-links.feature): the invite and transfer
 * link opengame.org/play/<appId> must be claimed on both platforms. A native build ships these.
 */
// The mobile tsconfig has no Node types; jest runs from apps/mobile.
const fs = jest.requireActual<{ readFileSync(path: string, encoding: "utf8"): string }>("fs");
const app = appJson.expo;
const assetlinks = JSON.parse(fs.readFileSync("../web/public/.well-known/assetlinks.json", "utf8"));
const aasa = JSON.parse(
  fs.readFileSync("../web/public/.well-known/apple-app-site-association", "utf8"),
);

describe("app link config", () => {
  it("iOS: the app claims opengame.org and triviajam.tv", () => {
    expect(app.ios.associatedDomains).toEqual(
      expect.arrayContaining(["applinks:opengame.org", "applinks:triviajam.tv"]),
    );
  });

  // /join/*: the TV's join QR (2026-10-06-join-and-invite.feature, "Scanning with the app installed
  // opens the app"). iOS reads it from the site; Android's /join/ filter waits for a native build.
  it("iOS: opengame.org hands the app /play/*, /join/* and /open", () => {
    expect(aasa.applinks.details).toEqual([
      {
        appID: `${app.ios.appleTeamId}.${app.ios.bundleIdentifier}`,
        paths: ["/open", "/open/*", "/play/*", "/join/*"],
      },
    ]);
  });

  it("Android: the app verifies opengame.org /open and /play/", () => {
    const hosts = app.android.intentFilters.flatMap((f) =>
      f.data.map((d) => `${d.host}${d.pathPrefix}`),
    );
    expect(hosts).toEqual(["opengame.org/open", "opengame.org/play/"]);
    expect(app.android.intentFilters.every((f) => f.autoVerify)).toBe(true);
  });

  it("Android: opengame.org's assetlinks.json names the app and its EAS signing keys", () => {
    expect(assetlinks).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: app.android.package,
          sha256_cert_fingerprints: [
            "00:EF:59:A5:97:64:46:4F:AE:33:D3:3C:BF:17:26:B6:6B:A7:59:60:A3:3C:76:AF:B7:42:B6:0E:64:28:A7:63",
            "5E:8E:0B:C2:05:FB:89:21:A7:45:CF:1A:79:33:8A:6B:3F:F5:A7:D6:15:83:49:91:D6:31:9E:27:47:A0:6A:20",
          ],
        },
      },
    ]);
  });
});
