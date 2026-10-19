import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "./cli";
import { saveCredentials } from "./io";

/**
 * ogs manifest check and ogs publish (docs/design-docs/ogs-cli.md, the catalogue group) against a
 * stand-in API. services/api/test/cli-catalogue.test.ts runs them against the real routes.
 */
const API = "https://api.test";
const KEY = "ogsk_test_comet";
let dir: string;
let out: string[];
let err: string[];
let requests: { method: string; url: string; auth: string | null; body: unknown }[];
let routes: Record<string, (body: unknown) => Response>;

function io(): Io {
  return {
    env: { OGS_API: API, OGS_CONFIG_DIR: dir },
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

const COMET = {
  appId: "comet-catch",
  name: "Comet Catch",
  shape: "couch",
  tv: "required",
  startUrl: "https://comet.example/",
  tvUrl: "https://comet.example/tv",
  roles: [
    { id: "pilot", label: "Pilot", audience: "grownup" },
    { id: "catcher", label: "Catcher", audience: "kid" },
  ],
  art: { tile: "https://comet.example/art/tile.jpg" },
};
const writeManifest = (m: unknown, name = "ogs.manifest.json") => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(m));
  return path;
};
const CHECK = `POST ${API}/api/v1/manifests/check`;
const ENTRY = `${API}/api/v1/apps/comet-catch/catalogue-entry`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ogs-catalogue-"));
  out = [];
  err = [];
  requests = [];
  routes = {};
});

describe("ogs manifest check", () => {
  it("a valid manifest: checked locally, then on the API; prints valid and exits 0", async () => {
    routes[CHECK] = () =>
      Response.json({
        valid: true,
        issues: [],
        warnings: [],
        checked: { startUrl: 200, tvUrl: 200, frameable: true },
      });
    expect(await run(["manifest", "check", writeManifest(COMET)], io())).toBe(0);
    expect(requests).toEqual([
      { method: "POST", url: `${API}/api/v1/manifests/check`, auth: null, body: COMET },
    ]);
    expect(out).toEqual([
      "checked: startUrl 200, tvUrl 200, framed by the OGS launcher: yes",
      "valid: comet-catch has no issues",
    ]);
    expect(err).toEqual([]);
  });

  it("reads ogs.manifest.json by default", async () => {
    writeManifest(COMET);
    // A relative path resolves against the working directory; this test's is `dir` (no
    // process.chdir: Stryker runs the suite in worker threads, which can't change directory).
    const inDir = { ...io(), readFile: (p: string) => readFileSync(resolve(dir, p), "utf8") };
    expect(await run(["manifest", "check", "--offline"], inDir)).toBe(0);
    expect(out.join("\n")).toContain("valid");
  });

  it("lists the API's warnings; they don't fail the check", async () => {
    routes[CHECK] = () =>
      Response.json({
        valid: true,
        issues: [],
        warnings: [
          { code: "no_kid_role", message: "No role has audience kid" },
          { code: "missing_art", message: "The art kit is missing icon" },
          { code: "start_url_not_https", message: "startUrl must be https" },
        ],
        checked: { startUrl: 200 },
      });
    expect(await run(["manifest", "check", writeManifest(COMET)], io())).toBe(0);
    expect(out).toEqual([
      "warning no_kid_role: No role has audience kid",
      "warning missing_art: The art kit is missing icon",
      "warning start_url_not_https: startUrl must be https",
      "checked: startUrl 200",
      "valid: comet-catch has no issues (3 warnings)",
    ]);
  });

  it("a TV page that can't be framed and an unreachable start URL", async () => {
    routes[CHECK] = () =>
      Response.json({
        valid: true,
        issues: [],
        warnings: [{ code: "tv_page_not_frameable", message: "blocked" }],
        checked: { startUrl: 503, tvUrl: 200, frameable: false },
      });
    expect(await run(["manifest", "check", writeManifest(COMET)], io())).toBe(0);
    expect(out).toContain("checked: startUrl 503, tvUrl 200, framed by the OGS launcher: no");
  });

  it("schema issues are named by path, the API isn't called, and it exits 1", async () => {
    const { startUrl: _s, ...noStart } = COMET;
    expect(
      await run(["manifest", "check", writeManifest({ ...noStart, shape: "solo" })], io()),
    ).toBe(1);
    expect(requests).toEqual([]);
    expect(out).toEqual([]);
    expect(err[0]).toMatch(/^issue shape: /);
    expect(err[1]).toMatch(/^issue startUrl: /);
    expect(err.at(-1)).toBe("invalid: 2 issues");
  });

  it("issues the API finds also fail the check", async () => {
    routes[CHECK] = () =>
      Response.json({
        valid: false,
        issues: [{ path: "appId", message: "taken" }],
        warnings: [],
        checked: {},
      });
    expect(await run(["manifest", "check", writeManifest(COMET)], io())).toBe(1);
    expect(err).toEqual(["issue appId: taken", "invalid: 1 issue"]);
  });

  it("--offline checks the schema only", async () => {
    expect(await run(["manifest", "check", writeManifest(COMET), "--offline"], io())).toBe(0);
    expect(requests).toEqual([]);
    expect(out).toEqual([
      "valid: comet-catch has no schema issues (offline: no catalogue rules or live checks)",
    ]);
  });

  it("a missing file or one that isn't JSON exits 1 and says which", async () => {
    expect(await run(["manifest", "check", join(dir, "nope.json")], io())).toBe(1);
    expect(err.at(-1)).toContain("Can't read");
    expect(err.at(-1)).toContain("nope.json");
    writeFileSync(join(dir, "bad.json"), "{");
    expect(await run(["manifest", "check", join(dir, "bad.json")], io())).toBe(1);
    expect(err.at(-1)).toContain("isn't JSON");
  });

  it("the API's error (e.g. rate limited) exits 1", async () => {
    routes[CHECK] = () =>
      Response.json(
        { error: { code: "rate_limited", message: "Too many", status: 429 } },
        { status: 429 },
      );
    expect(await run(["manifest", "check", writeManifest(COMET)], io())).toBe(1);
    expect(err).toEqual(["rate_limited: Too many"]);
  });
});

describe("ogs publish", () => {
  beforeEach(() =>
    saveCredentials(io(), { currentApp: "comet-catch", apps: { "comet-catch": { key: KEY } } }),
  );

  it("submits the manifest with the game's key and prints pending review", async () => {
    routes[`PUT ${ENTRY}`] = () =>
      Response.json(
        { appId: "comet-catch", status: "pending", submittedAt: Date.UTC(2026, 9, 18, 12) },
        { status: 202 },
      );
    expect(await run(["publish", writeManifest(COMET)], io())).toBe(0);
    expect(requests).toEqual([{ method: "PUT", url: ENTRY, auth: `Bearer ${KEY}`, body: COMET }]);
    expect(out).toEqual([
      "comet-catch: pending review (submitted 2026-10-18T12:00:00.000Z)",
      "See where it stands: ogs publish --status",
    ]);
  });

  it("an invalid manifest isn't sent", async () => {
    expect(await run(["publish", writeManifest({ ...COMET, tv: "always" })], io())).toBe(1);
    expect(requests).toEqual([]);
    expect(err[0]).toMatch(/^issue tv: /);
  });

  it("the API's refusal (another game's key) exits 1 with its code", async () => {
    routes[`PUT ${ENTRY}`] = () =>
      Response.json(
        {
          error: {
            code: "wrong_game",
            message: "This API key belongs to another game",
            status: 403,
          },
        },
        { status: 403 },
      );
    expect(await run(["publish", writeManifest(COMET)], io())).toBe(1);
    expect(err).toEqual(["wrong_game: This API key belongs to another game"]);
  });

  it("without a login it says how to log in", async () => {
    expect(await run(["publish", writeManifest(COMET), "--app", "other-game"], io())).toBe(1);
    expect(err.join("\n")).toContain("ogs login");
  });

  describe("--status", () => {
    const status = (body: unknown) => {
      routes[`GET ${ENTRY}`] = () => Response.json(body);
    };

    it("pending, with the live manifest still live", async () => {
      status({
        appId: "comet-catch",
        status: "pending",
        submittedAt: Date.UTC(2026, 9, 18, 12),
        reviewedAt: Date.UTC(2026, 9, 17),
        live: { ...COMET, tagline: "", shop: {}, instanceTtlMs: 1 },
        pending: { ...COMET, name: "Comet Catch Deluxe", tagline: "", shop: {}, instanceTtlMs: 1 },
      });
      expect(await run(["publish", "--status"], io())).toBe(0);
      expect(requests[0]).toMatchObject({ method: "GET", url: ENTRY, auth: `Bearer ${KEY}` });
      expect(out).toEqual([
        "comet-catch: pending review (submitted 2026-10-18T12:00:00.000Z)",
        "live: Comet Catch (https://comet.example/)",
        "pending: Comet Catch Deluxe (https://comet.example/)",
      ]);
    });

    it("live", async () => {
      status({
        appId: "comet-catch",
        status: "live",
        submittedAt: 1,
        reviewedAt: Date.UTC(2026, 9, 18),
        live: COMET,
      });
      expect(await run(["publish", "--status"], io())).toBe(0);
      expect(out).toEqual([
        "comet-catch: live in the catalogue (approved 2026-10-18T00:00:00.000Z)",
        "live: Comet Catch (https://comet.example/)",
      ]);
    });

    it("rejected, with the reviewer's note", async () => {
      status({
        appId: "comet-catch",
        status: "rejected",
        submittedAt: 1,
        reviewedAt: Date.UTC(2026, 9, 18),
        note: "The TV page shows a QR code when framed",
      });
      expect(await run(["publish", "--status"], io())).toBe(0);
      expect(out).toEqual([
        "comet-catch: rejected (reviewed 2026-10-18T00:00:00.000Z)",
        "note: The TV page shows a QR code when framed",
      ]);
    });

    it("never submitted", async () => {
      status({ appId: "comet-catch", status: "none" });
      expect(await run(["publish", "--status"], io())).toBe(0);
      expect(out).toEqual(["comet-catch: not submitted yet. Run: ogs publish"]);
    });
  });
});

describe("help", () => {
  it("lists the catalogue commands", async () => {
    expect(await run(["--help"], io())).toBe(0);
    expect(out.join("\n")).toContain("ogs manifest check [file] [--offline]");
    expect(out.join("\n")).toContain("ogs publish [file] [--status]");
  });
});
