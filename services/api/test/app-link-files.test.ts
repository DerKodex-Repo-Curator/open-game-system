import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { assetlinks, OGS_AASA, OGS_ASSETLINKS, siteAssociation } from "../src/lib/app-link-files";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * opengame.org's link files with every registered white-label app (2026-10-18-white-label-apps.feature,
 * "Links"): the API builds them; opengame.org's Pages Functions pass them through.
 */
const LINKS = {
  ios: [{ appId: "rocket-crew", appleAppId: "34S957HD77.tv.rocketcrew.app" }],
  android: [{ appId: "rocket-crew", package: "tv.rocketcrew.app", sha256CertFingerprints: ["AB:CD"] }],
};
const staticFile = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../apps/web/public/.well-known/${name}`, import.meta.url).pathname, "utf8"));

describe("the link files", () => {
  it("the OGS app's own entries are opengame.org's static files' (they don't drift)", () => {
    expect(siteAssociation({ ios: [], android: [] })).toEqual(staticFile("apple-app-site-association"));
    expect(assetlinks({ ios: [], android: [] })).toEqual(staticFile("assetlinks.json"));
    expect(OGS_AASA.appID).toBe("34S957HD77.org.opengame.app");
    expect(OGS_ASSETLINKS.target.package_name).toBe("org.opengame.app");
  });

  it("each registered app comes first, for /play/<appId> and /play/<appId>/*, before the OGS app", () => {
    const details = siteAssociation(LINKS).applinks.details;
    expect(details[0]).toEqual({ appID: "34S957HD77.tv.rocketcrew.app", paths: ["/play/rocket-crew", "/play/rocket-crew/*"] });
    expect(details[1]?.appID).toBe("34S957HD77.org.opengame.app");
  });

  it("assetlinks lists each registered package with its fingerprints, then the OGS app", () => {
    const links = assetlinks(LINKS);
    expect(links.map((l) => l.target.package_name)).toEqual(["tv.rocketcrew.app", "org.opengame.app"]);
    expect(links[0]?.target.sha256_cert_fingerprints).toEqual(["AB:CD"]);
  });
});

describe("GET /api/v1/apps/apple-app-site-association and /assetlinks.json", () => {
  let d1: TestD1;
  beforeAll(async () => {
    d1 = await openTestD1();
  });
  afterAll(() => d1.dispose());
  beforeEach(async () => {
    await d1.reset();
    await d1.db
      .prepare("INSERT INTO native_apps (app_id, platform, store_id, team_id, created_at, updated_at) VALUES ('rocket-crew', 'ios', 'tv.rocketcrew.app', '34S957HD77', 1, 1)")
      .run();
  });

  it("serve the documents built from the registered apps, as JSON", async () => {
    const aasa = await app.request("/api/v1/apps/apple-app-site-association", {}, { DB: d1.db });
    expect(aasa.headers.get("content-type")).toContain("application/json");
    const body = await aasa.json();
    expect(JSON.stringify(body)).toContain("34S957HD77.tv.rocketcrew.app");
    const links = await app.request("/api/v1/apps/assetlinks.json", {}, { DB: d1.db });
    expect(await links.json()).toEqual(staticFile("assetlinks.json"));
  });
});
