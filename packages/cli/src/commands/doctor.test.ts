import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "../cli";
import { saveCredentials } from "../io";

/**
 * `ogs doctor`, every check and what it prints (docs/acceptance/2026-10-18-ogs-cli.feature), against
 * a stand-in API and link domains at fetch.
 */
const API = "https://api.test";
const KEY = "ogsk_test_rocketcrew";
const AASA = "/.well-known/apple-app-site-association";
const LINKS = "/.well-known/assetlinks.json";
let dir: string;
let out: string[];
let err: string[];
let routes: Record<string, () => Response>;
let fetched: string[];

function io(env: Record<string, string> = {}): Io {
  return {
    env: { OGS_API: API, OGS_CONFIG_DIR: dir, ...env },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => readFileSync(p, "utf8"),
    fetch: async (input) => {
      const url = String(input);
      fetched.push(url);
      const route = routes[url];
      return route ? route() : new Response("not found", { status: 404 });
    },
  };
}

const ios = { platform: "ios", bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" };
const android = {
  platform: "android",
  package: "tv.rocketcrew.app",
  sha256CertFingerprints: ["AB:CD"],
};
const native = (apps: unknown[]) => () => Response.json({ apps });
const creds = (iosOn: boolean, androidOn: boolean) => () =>
  Response.json({
    ios: iosOn ? { configured: true, keyId: "ABC123DEFG" } : { configured: false },
    android: androidOn ? { configured: true, projectId: "rc-push" } : { configured: false },
  });
const aasa = (details: { appID: string; paths: string[] }[]) => () =>
  Response.json({ applinks: { details } });
const listed = aasa([{ appID: "34S957HD77.tv.rocketcrew.app", paths: ["/play/rocket-crew/*"] }]);
const assetlinks = (names: (string | undefined)[]) => () =>
  Response.json(names.map((package_name) => ({ target: { package_name } })));
const catalogue = (games: unknown[]) => () => Response.json(games);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ogs-doctor-"));
  saveCredentials(io(), { currentApp: "rocket-crew", apps: { "rocket-crew": { key: KEY } } });
  out = [];
  err = [];
  fetched = [];
  routes = {
    [`${API}/api/v1/apps/rocket-crew/native`]: native([ios, android]),
    [`${API}/api/v1/apps/rocket-crew/push-credentials`]: creds(true, true),
    [`https://opengame.org${AASA}`]: listed,
    [`https://opengame.org${LINKS}`]: assetlinks([undefined, "tv.rocketcrew.app"]),
    [`${API}/api/v1/catalogue`]: catalogue([
      { appId: "other" },
      { appId: "rocket-crew", tvUrl: "https://rc.example/tv" },
    ]),
    "https://rc.example/tv": () => new Response("<html>"),
  };
});

const doctor = (args: string[] = [], env: Record<string, string> = {}) =>
  run(["doctor", ...args], io(env));

describe("ogs doctor", () => {
  it("both apps healthy: every line ok, exit 0", async () => {
    expect(await doctor()).toBe(0);
    expect(out).toEqual([
      "ok   ios app registered: tv.rocketcrew.app (team 34S957HD77)",
      "ok   android app registered: tv.rocketcrew.app",
      "ok   ios push credentials: key ABC123DEFG",
      "ok   android push credentials: project rc-push",
      "ok   opengame.org apple-app-site-association lists 34S957HD77.tv.rocketcrew.app for /play/rocket-crew/*",
      "ok   opengame.org assetlinks.json lists tv.rocketcrew.app",
      "ok   tvUrl answers: https://rc.example/tv",
    ]);
    expect(err).toEqual([]);
  });

  it("no app registered: says how to register; no link checks", async () => {
    routes[`${API}/api/v1/apps/rocket-crew/native`] = native([]);
    expect(await doctor()).toBe(1);
    expect(out).toEqual([
      "FAIL no app registered for rocket-crew. Run: ogs apps register --ios <bundle id> --team-id <team id>",
      "ok   tvUrl answers: https://rc.example/tv",
    ]);
    expect(fetched.some((u) => u.includes("/.well-known/"))).toBe(false);
  });

  it("android only: android checks, nothing about ios", async () => {
    routes[`${API}/api/v1/apps/rocket-crew/native`] = native([android]);
    routes[`${API}/api/v1/apps/rocket-crew/push-credentials`] = creds(false, false);
    expect(await doctor()).toBe(1);
    expect(out).toEqual([
      "ok   android app registered: tv.rocketcrew.app",
      "FAIL android push credentials: none uploaded. Run: ogs push credentials --android service-account.json",
      "ok   opengame.org assetlinks.json lists tv.rocketcrew.app",
      "ok   tvUrl answers: https://rc.example/tv",
    ]);
    expect(fetched).not.toContain(`https://opengame.org${AASA}`);
  });

  it("ios only: ios checks, nothing about android", async () => {
    routes[`${API}/api/v1/apps/rocket-crew/native`] = native([ios]);
    expect(await doctor()).toBe(0);
    expect(out.join("\n")).not.toContain("android");
    expect(fetched).not.toContain(`https://opengame.org${LINKS}`);
  });

  it("files that don't list the apps (yet)", async () => {
    routes[`https://opengame.org${AASA}`] = aasa([
      { appID: "34S957HD77.tv.rocketcrew.app", paths: ["/play/other/*"] },
      { appID: "OTHER.tv.rocketcrew.app", paths: ["/play/rocket-crew/*"] },
    ]);
    routes[`https://opengame.org${LINKS}`] = assetlinks(["tv.other.app"]);
    expect(await doctor()).toBe(1);
    expect(out).toContain(
      "FAIL opengame.org apple-app-site-association doesn't list 34S957HD77.tv.rocketcrew.app yet (it updates within 5 minutes of registering)",
    );
    expect(out).toContain("FAIL opengame.org assetlinks.json doesn't list tv.rocketcrew.app");
  });

  it("files that can't be read say why", async () => {
    routes[`https://opengame.org${AASA}`] = () => new Response("down", { status: 503 });
    routes[`https://opengame.org${LINKS}`] = () => Response.json({ not: "a list" });
    expect(await doctor()).toBe(1);
    expect(out).toContain("FAIL opengame.org apple-app-site-association: HTTP 503");
    expect(out.find((l) => l.startsWith("FAIL opengame.org assetlinks.json: "))).toBeDefined();
  });

  it("a fetch that throws something odd still names the file", async () => {
    const base = io();
    const odd: Io = {
      ...base,
      fetch: async (input, init) => {
        if (String(input).includes("/.well-known/")) throw "offline";
        if (String(input).endsWith("/catalogue")) throw "no catalogue";
        return base.fetch(input, init);
      },
    };
    expect(await run(["doctor"], odd)).toBe(1);
    expect(out).toContain("FAIL opengame.org apple-app-site-association: offline");
    expect(out).toContain("FAIL opengame.org assetlinks.json: offline");
    expect(out).toContain("FAIL catalogue: no catalogue");
  });

  it("--domain checks the developer's own domain too; it only has to list the app", async () => {
    routes[`https://rocketcrew.example${AASA}`] = aasa([
      { appID: "34S957HD77.tv.rocketcrew.app", paths: ["/*"] },
    ]);
    routes[`https://rocketcrew.example${LINKS}`] = assetlinks(["tv.rocketcrew.app"]);
    expect(await doctor(["--domain", "https://rocketcrew.example"])).toBe(0);
    expect(out).toContain(
      "ok   rocketcrew.example apple-app-site-association lists 34S957HD77.tv.rocketcrew.app",
    );
    expect(out).toContain("ok   rocketcrew.example assetlinks.json lists tv.rocketcrew.app");
  });

  it("an own domain that doesn't list the app: add it to your file", async () => {
    routes[`https://rocketcrew.example${AASA}`] = aasa([]);
    routes[`https://rocketcrew.example${LINKS}`] = assetlinks(["tv.rocketcrew.app"]);
    expect(await doctor(["--domain", "http://rocketcrew.example"])).toBe(1);
    expect(out).toContain(
      "FAIL rocketcrew.example apple-app-site-association doesn't list 34S957HD77.tv.rocketcrew.app (add it to your domain's file)",
    );
  });

  it("--domain naming OGS's own site checks it once, as OGS's", async () => {
    expect(await doctor(["--domain", "opengame.org"])).toBe(0);
    expect(
      out
        .filter((l) => l.includes("apple-app-site-association lists"))
        .every((l) => l.endsWith("for /play/rocket-crew/*")),
    ).toBe(true);
  });

  it("OGS_SITE points the check at another link domain", async () => {
    routes[`https://preview.opengame.test${AASA}`] = listed;
    routes[`https://preview.opengame.test${LINKS}`] = assetlinks(["tv.rocketcrew.app"]);
    expect(await doctor([], { OGS_SITE: "https://preview.opengame.test" })).toBe(0);
    expect(fetched).not.toContain(`https://opengame.org${AASA}`);
    expect(out).toContain(
      "ok   preview.opengame.test apple-app-site-association lists 34S957HD77.tv.rocketcrew.app for /play/rocket-crew/*",
    );
  });

  it("not in the catalogue: a note, not a failure", async () => {
    routes[`${API}/api/v1/catalogue`] = catalogue([{ appId: "other" }]);
    expect(await doctor()).toBe(0);
    expect(out.at(-1)).toBe(
      "--   rocket-crew isn't in the OGS catalogue (casting uses the TV page your phone page declares)",
    );
  });

  it("no tvUrl: a note", async () => {
    routes[`${API}/api/v1/catalogue`] = catalogue([{ appId: "rocket-crew" }]);
    expect(await doctor()).toBe(0);
    expect(out.at(-1)).toBe(
      "--   no tvUrl in the manifest (the TV shows the page your phone page declares)",
    );
  });

  it("a tvUrl that doesn't answer fails", async () => {
    routes["https://rc.example/tv"] = () => new Response("gone", { status: 410 });
    expect(await doctor()).toBe(1);
    expect(out.at(-1)).toBe("FAIL tvUrl https://rc.example/tv answered HTTP 410");
  });

  it("a catalogue that can't be read fails", async () => {
    routes[`${API}/api/v1/catalogue`] = () => new Response("down", { status: 500 });
    expect(await doctor()).toBe(1);
    expect(out.at(-1)).toBe("FAIL catalogue: HTTP 500");
  });

  it("--app checks another logged-in app", async () => {
    saveCredentials(io(), {
      currentApp: "rocket-crew",
      apps: { "rocket-crew": { key: KEY }, comet: { key: "ogsk_test_comet" } },
    });
    routes[`${API}/api/v1/apps/comet/native`] = native([]);
    routes[`${API}/api/v1/apps/comet/push-credentials`] = creds(false, false);
    expect(await doctor(["--app", "comet"])).toBe(1);
    expect(out[0]).toBe(
      "FAIL no app registered for comet. Run: ogs apps register --ios <bundle id> --team-id <team id>",
    );
  });
});
