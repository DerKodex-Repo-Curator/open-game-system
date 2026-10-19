import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "./cli";

/**
 * The ogs CLI (docs/acceptance/2026-10-18-ogs-cli.feature) against a stand-in API at fetch. The
 * API-side seam test (services/api/test/cli-seam.test.ts) runs the same commands against the real API.
 */
const API = "https://api.test";
const KEY = "ogsk_test_rocketcrew";
let dir: string;
let out: string[];
let err: string[];
let requests: { method: string; url: string; auth: string | null; body: unknown }[];
let routes: Record<string, (body: unknown) => Response>;

function io(env: Record<string, string> = {}): Io {
  return {
    env: { OGS_API: API, OGS_CONFIG_DIR: dir, ...env },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => readFileSync(p, "utf8"),
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, auth: new Headers(init?.headers).get("authorization"), body });
      const route = routes[`${method} ${url}`];
      return route ? route(body) : new Response("not found", { status: 404 });
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ogs-cli-"));
  out = [];
  err = [];
  requests = [];
  routes = {
    [`GET ${API}/api/v1/apps/rocket-crew/native`]: () => Response.json({ apps: [] }),
  };
});

const login = () => run(["login", "--app", "rocket-crew", "--key", KEY], io());

describe("ogs login", () => {
  it("checks the key with the API and saves it (mode 0600)", async () => {
    expect(await login()).toBe(0);
    const file = join(dir, "credentials.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      currentApp: "rocket-crew",
      apps: { "rocket-crew": { key: KEY } },
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(requests[0]).toMatchObject({
      url: `${API}/api/v1/apps/rocket-crew/native`,
      auth: `Bearer ${KEY}`,
    });
  });
  it("a key the API refuses is not saved", async () => {
    routes[`GET ${API}/api/v1/apps/rocket-crew/native`] = () =>
      Response.json({ error: { code: "invalid_api_key" } }, { status: 401 });
    expect(await login()).toBe(1);
    expect(() => statSync(join(dir, "credentials.json"))).toThrow();
    expect(err.join("\n")).toContain("invalid_api_key");
  });
  it("needs --app and --key", async () => {
    expect(await run(["login"], io())).toBe(2);
  });
});

describe("ogs apps register", () => {
  it("registers the iOS app with the saved key", async () => {
    await login();
    routes[`PUT ${API}/api/v1/apps/rocket-crew/native/ios`] = (b) =>
      Response.json({ appId: "rocket-crew", platform: "ios", ...(b as object) }, { status: 201 });
    expect(
      await run(
        ["apps", "register", "--ios", "tv.rocketcrew.app", "--team-id", "34S957HD77"],
        io(),
      ),
    ).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: "PUT",
      auth: `Bearer ${KEY}`,
      body: { bundleId: "tv.rocketcrew.app", teamId: "34S957HD77" },
    });
    expect(out.join("\n")).toContain("Registered ios app tv.rocketcrew.app for rocket-crew");
  });
  it("registers the Android app with fingerprints and Google client ids", async () => {
    await login();
    routes[`PUT ${API}/api/v1/apps/rocket-crew/native/android`] = (b) =>
      Response.json(
        { appId: "rocket-crew", platform: "android", ...(b as object) },
        { status: 201 },
      );
    expect(
      await run(
        [
          "apps",
          "register",
          "--android",
          "tv.rocketcrew.app",
          "--sha256",
          "AB:CD,EF:01",
          "--google-client-id",
          "123-abc.apps.googleusercontent.com",
        ],
        io(),
      ),
    ).toBe(0);
    expect(requests.at(-1)?.body).toEqual({
      package: "tv.rocketcrew.app",
      sha256CertFingerprints: ["AB:CD", "EF:01"],
      googleClientIds: ["123-abc.apps.googleusercontent.com"],
    });
  });
  it("without a login it says how to log in", async () => {
    expect(
      await run(
        ["apps", "register", "--ios", "tv.rocketcrew.app", "--team-id", "34S957HD77"],
        io(),
      ),
    ).toBe(1);
    expect(err.join("\n")).toContain("ogs login --app");
  });
  it("shows the API's error", async () => {
    await login();
    routes[`PUT ${API}/api/v1/apps/rocket-crew/native/ios`] = () =>
      Response.json(
        {
          error: {
            code: "app_id_taken",
            message: "That bundle id / package is registered to another game",
          },
        },
        { status: 409 },
      );
    expect(
      await run(
        ["apps", "register", "--ios", "tv.rocketcrew.app", "--team-id", "34S957HD77"],
        io(),
      ),
    ).toBe(1);
    expect(err.join("\n")).toContain("app_id_taken");
  });
});

describe("ogs push credentials", () => {
  it("uploads the .p8 and prints what's configured, never the key", async () => {
    await login();
    const p8 = join(dir, "AuthKey_ABC123DEFG.p8");
    writeFileSync(p8, "-----BEGIN PRIVATE KEY-----\nSECRETSECRET\n-----END PRIVATE KEY-----\n");
    routes[`PUT ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      new Response(null, { status: 204 });
    routes[`GET ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      Response.json({
        ios: {
          configured: true,
          keyId: "ABC123DEFG",
          teamId: "34S957HD77",
          bundleId: "tv.rocketcrew.app",
        },
        android: { configured: false },
      });
    expect(
      await run(
        ["push", "credentials", "--ios", p8, "--key-id", "ABC123DEFG", "--team-id", "34S957HD77"],
        io(),
      ),
    ).toBe(0);
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      ios: { p8: readFileSync(p8, "utf8"), keyId: "ABC123DEFG", teamId: "34S957HD77" },
    });
    expect(out.join("\n")).toContain(
      "ios: configured (key ABC123DEFG, team 34S957HD77, tv.rocketcrew.app)",
    );
    expect(out.join("\n")).not.toContain("SECRET");
  });
  it("uploads the service account JSON", async () => {
    await login();
    const sa = join(dir, "service-account.json");
    writeFileSync(
      sa,
      JSON.stringify({
        type: "service_account",
        project_id: "p",
        private_key: "k",
        client_email: "e@p.iam.gserviceaccount.com",
      }),
    );
    routes[`PUT ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      new Response(null, { status: 204 });
    routes[`GET ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      Response.json({
        ios: { configured: false },
        android: {
          configured: true,
          projectId: "p",
          clientEmail: "e@p.iam.gserviceaccount.com",
          package: "tv.rocketcrew.app",
        },
      });
    expect(await run(["push", "credentials", "--android", sa], io())).toBe(0);
    expect(requests.find((r) => r.method === "PUT")?.body).toMatchObject({
      android: { serviceAccount: { project_id: "p" } },
    });
  });
});

describe("ogs doctor", () => {
  const healthy = () => {
    routes[`GET ${API}/api/v1/apps/rocket-crew/native`] = () =>
      Response.json({
        apps: [
          {
            appId: "rocket-crew",
            platform: "ios",
            bundleId: "tv.rocketcrew.app",
            teamId: "34S957HD77",
          },
        ],
      });
    routes[`GET ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      Response.json({
        ios: {
          configured: true,
          keyId: "ABC123DEFG",
          teamId: "34S957HD77",
          bundleId: "tv.rocketcrew.app",
        },
        android: { configured: false },
      });
    routes[`GET https://opengame.org/.well-known/apple-app-site-association`] = () =>
      Response.json({
        applinks: {
          apps: [],
          details: [
            {
              appID: "34S957HD77.tv.rocketcrew.app",
              paths: ["/play/rocket-crew", "/play/rocket-crew/*"],
            },
          ],
        },
      });
    routes[`GET ${API}/api/v1/catalogue`] = () =>
      Response.json([{ appId: "rocket-crew", tvUrl: "https://rocket-crew.example/tv" }]);
    routes[`GET https://rocket-crew.example/tv`] = () => new Response("<html>", { status: 200 });
  };

  it("all checks pass: exit 0, one line each", async () => {
    await login();
    healthy();
    expect(await run(["doctor"], io())).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("ok   ios app registered: tv.rocketcrew.app (team 34S957HD77)");
    expect(text).toContain("ok   ios push credentials: key ABC123DEFG");
    expect(text).toContain(
      "ok   opengame.org apple-app-site-association lists 34S957HD77.tv.rocketcrew.app for /play/rocket-crew/*",
    );
    expect(text).toContain("ok   tvUrl answers: https://rocket-crew.example/tv");
  });

  it("a failing check: exit 1 and what to do", async () => {
    await login();
    healthy();
    routes[`GET ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      Response.json({ ios: { configured: false }, android: { configured: false } });
    expect(await run(["doctor"], io())).toBe(1);
    expect(out.join("\n")).toContain(
      "FAIL ios push credentials: none uploaded. Run: ogs push credentials --ios AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --team-id 34S957HD77",
    );
  });

  it("checks the developer's own domain when given", async () => {
    await login();
    healthy();
    routes[`GET https://rocketcrew.example/.well-known/apple-app-site-association`] = () =>
      new Response("not found", { status: 404 });
    expect(await run(["doctor", "--domain", "rocketcrew.example"], io())).toBe(1);
    expect(out.join("\n")).toContain("FAIL rocketcrew.example apple-app-site-association");
  });
});

describe("the API base", () => {
  it("OGS_API points every command at a preview", async () => {
    await run(
      ["login", "--app", "rocket-crew", "--key", KEY],
      io({ OGS_API: "https://preview.test" }),
    );
    expect(requests[0]?.url).toBe("https://preview.test/api/v1/apps/rocket-crew/native");
  });
  it("help lists the commands", async () => {
    expect(await run(["--help"], io())).toBe(0);
    expect(out.join("\n")).toMatch(/login[\s\S]*apps register[\s\S]*push credentials[\s\S]*doctor/);
  });
});
