import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "../cli";
import { saveCredentials } from "../io";

/**
 * Exactly what each command prints and sends, on its every path (cli.test.ts, deliver.test.ts and
 * catalogue.test.ts walk the main flows).
 */
const API = "https://api.test";
const KEY = "ogsk_test_rocketcrew";
let dir: string;
let out: string[];
let err: string[];
let requests: { method: string; url: string; body: unknown }[];
let routes: Record<string, (body: unknown) => Response>;
let commands: { command: string; cwd: string }[];
let deployed: { code: number; output: string };

function io(over: Partial<Io> = {}): Io {
  return {
    env: { OGS_API: API, OGS_CONFIG_DIR: dir },
    cwd: () => dir,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => readFileSync(p, "utf8"),
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });
      const route = routes[`${method} ${url}`];
      return route ? route(body) : new Response("not found", { status: 404 });
    },
    exec: async (command, opts) => {
      commands.push({ command, cwd: opts.cwd });
      return deployed;
    },
    ...over,
  };
}

const loggedIn = () =>
  saveCredentials(io(), { currentApp: "rocket-crew", apps: { "rocket-crew": { key: KEY } } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ogs-out-"));
  out = [];
  err = [];
  requests = [];
  commands = [];
  deployed = { code: 0, output: "https://rc-try.jon.workers.dev" };
  routes = {};
});

describe("ogs login", () => {
  it("says where the key is saved", async () => {
    routes[`GET ${API}/api/v1/apps/rocket-crew/native`] = () => Response.json({ apps: [] });
    expect(await run(["login", "--app", "rocket-crew", "--key", KEY], io())).toBe(0);
    expect(out).toEqual([
      `Logged in for rocket-crew. The key is saved in ${join(dir, "credentials.json")}.`,
    ]);
  });

  it("keeps the other apps' keys", async () => {
    saveCredentials(io(), { currentApp: "comet", apps: { comet: { key: "ogsk_c" } } });
    routes[`GET ${API}/api/v1/apps/rocket-crew/native`] = () => Response.json({ apps: [] });
    await run(["login", "--app", "rocket-crew", "--key", KEY], io());
    expect(JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8"))).toEqual({
      currentApp: "rocket-crew",
      apps: { comet: { key: "ogsk_c" }, "rocket-crew": { key: KEY } },
    });
  });

  it.each([
    [["--app", "rocket-crew"]],
    [["--key", KEY]],
    [[]],
  ])("%j: usage (exit 2), nothing sent", async (args) => {
    expect(await run(["login", ...args], io())).toBe(2);
    expect(err).toEqual(["Usage: ogs login --app <appId> --key <game API key>"]);
    expect(requests).toEqual([]);
  });
});

describe("ogs apps register", () => {
  beforeEach(loggedIn);
  const usage =
    "Usage: ogs apps register --ios <bundle id> --team-id <team id> | --android <package> --sha256 <fingerprint,...>";

  it("android without Google client ids sends an empty list and says so", async () => {
    routes[`PUT ${API}/api/v1/apps/rocket-crew/native/android`] = () =>
      Response.json({}, { status: 201 });
    expect(
      await run(["apps", "register", "--android", "tv.rc.app", "--sha256", "AB:CD"], io()),
    ).toBe(0);
    expect(requests).toEqual([
      {
        method: "PUT",
        url: `${API}/api/v1/apps/rocket-crew/native/android`,
        body: { package: "tv.rc.app", sha256CertFingerprints: ["AB:CD"], googleClientIds: [] },
      },
    ]);
    expect(out).toEqual(["Registered android app tv.rc.app for rocket-crew."]);
  });

  it("ios says what it registered", async () => {
    routes[`PUT ${API}/api/v1/apps/rocket-crew/native/ios`] = () =>
      Response.json({}, { status: 201 });
    await run(["apps", "register", "--ios", "tv.rc.app", "--team-id", "T"], io());
    expect(out).toEqual(["Registered ios app tv.rc.app for rocket-crew."]);
  });

  it.each([
    [["--ios", "tv.rc.app"]],
    [["--team-id", "T"]],
    [["--android", "tv.rc.app"]],
    [["--sha256", "AB:CD"]],
    [[]],
  ])("%j: usage (exit 2), nothing sent", async (args) => {
    expect(await run(["apps", "register", ...args], io())).toBe(2);
    expect(err).toEqual([usage]);
    expect(requests).toEqual([]);
  });
});

describe("ogs push credentials", () => {
  beforeEach(loggedIn);
  const usage =
    "Usage: ogs push credentials --ios <AuthKey.p8> --key-id <id> --team-id <id> | --android <service-account.json>";

  it("prints both platforms' state", async () => {
    const sa = join(dir, "sa.json");
    writeFileSync(sa, JSON.stringify({ project_id: "p" }));
    routes[`PUT ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      new Response(null, { status: 204 });
    routes[`GET ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      Response.json({
        ios: { configured: false },
        android: {
          configured: true,
          projectId: "p",
          clientEmail: "e@p.iam.gserviceaccount.com",
          package: "tv.rc.app",
        },
      });
    expect(await run(["push", "credentials", "--android", sa], io())).toBe(0);
    expect(out).toEqual([
      "ios: not configured",
      "android: configured (project p, e@p.iam.gserviceaccount.com, tv.rc.app)",
    ]);
  });

  it("ios configured, android not", async () => {
    const p8 = join(dir, "k.p8");
    writeFileSync(p8, "KEY");
    routes[`PUT ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      new Response(null, { status: 204 });
    routes[`GET ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      Response.json({
        ios: { configured: true, keyId: "K", teamId: "T", bundleId: "tv.rc.app" },
        android: { configured: false },
      });
    await run(["push", "credentials", "--ios", p8, "--key-id", "K", "--team-id", "T"], io());
    expect(out).toEqual(["ios: configured (key K, team T, tv.rc.app)", "android: not configured"]);
  });

  it("an answer without android is the API's mistake", async () => {
    const p8 = join(dir, "k.p8");
    writeFileSync(p8, "KEY");
    routes[`PUT ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      new Response(null, { status: 204 });
    routes[`GET ${API}/api/v1/apps/rocket-crew/push-credentials`] = () =>
      Response.json({ ios: { configured: false } });
    expect(
      await run(["push", "credentials", "--ios", p8, "--key-id", "K", "--team-id", "T"], io()),
    ).toBe(1);
    expect(err).toEqual(["Unexpected answer from the API"]);
  });

  it.each([
    [["--ios", "k.p8", "--key-id", "K"]],
    [["--ios", "k.p8", "--team-id", "T"]],
    [["--key-id", "K", "--team-id", "T"]],
    [[]],
  ])("%j: usage (exit 2), nothing sent", async (args) => {
    expect(await run(["push", "credentials", ...args], io())).toBe(2);
    expect(err).toEqual([usage]);
    expect(requests).toEqual([]);
  });
});

describe("ogs push send", () => {
  beforeEach(loggedIn);

  it("usage says it", async () => {
    expect(await run(["push", "send"], io())).toBe(2);
    expect(err).toEqual([
      "Usage: ogs push send --to <handle>[,<handle>] [--title <t>] [--body <b>] [--url <link>] [--when-open deliver|banner] [--check]",
    ]);
  });

  it("--check: a handle with surfaces after one that has none is still unreachable overall", async () => {
    routes[`GET ${API}/api/v1/games/rocket-crew/push-handles/ph_a`] = () =>
      Response.json({ handle: "ph_a", surfaces: [] });
    routes[`GET ${API}/api/v1/games/rocket-crew/push-handles/ph_b`] = () =>
      Response.json({ handle: "ph_b", surfaces: [{ kind: "app", lastActiveAt: "t" }] });
    expect(await run(["push", "send", "--to", "ph_a,ph_b", "--check"], io())).toBe(1);
    expect(out).toEqual([
      "ph_a  nowhere: no surface left (the player opts in again)",
      "ph_b  app (last active t)",
    ]);
  });

  it("--check: every handle reachable exits 0; handles are URL-encoded", async () => {
    routes[`GET ${API}/api/v1/games/rocket-crew/push-handles/ph%2Fa`] = () =>
      Response.json({ handle: "ph/a", surfaces: [{ kind: "web", lastActiveAt: "t" }] });
    expect(await run(["push", "send", "--to", "ph/a", "--check"], io())).toBe(0);
    expect(out).toEqual(["ph/a  web (last active t)"]);
  });

  it("--check: an answer of the wrong shape is the API's mistake, not a handle's", async () => {
    routes[`GET ${API}/api/v1/games/rocket-crew/push-handles/ph_a`] = () =>
      Response.json({ handle: "ph_a", surfaces: [{ kind: "fax", lastActiveAt: "t" }] });
    expect(await run(["push", "send", "--to", "ph_a", "--check"], io())).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["Unexpected answer from the API"]);
  });

  it("all sent exits 0", async () => {
    routes[`POST ${API}/api/v1/games/rocket-crew/notifications`] = () =>
      Response.json({ results: [{ to: "ph_a", status: "sent" }] });
    expect(await run(["push", "send", "--to", "ph_a", "--body", "B"], io())).toBe(0);
    expect(requests[0].body).toEqual({
      to: ["ph_a"],
      title: "Test push",
      body: "B",
      whenOpen: "deliver",
    });
  });
});

describe("ogs try", () => {
  beforeEach(loggedIn);
  const registered = () => {
    routes[`PUT ${API}/api/v1/apps/rocket-crew/try`] = (b) =>
      Response.json({
        appId: "rocket-crew",
        url: typeof b === "object" && b && "url" in b ? String(b.url) : "",
        checkedAt: "2026-10-18T15:00:00.000Z",
      });
  };

  it("prints what it deploys, checks and registers", async () => {
    registered();
    expect(await run(["try", "--command", "make deploy"], io())).toBe(0);
    expect(commands).toEqual([{ command: "make deploy", cwd: dir }]);
    expect(out).toEqual([
      "Deploying: make deploy",
      "Checking https://rc-try.jon.workers.dev (GET / and /ws-probe)…",
      "ok   try path https://rc-try.jon.workers.dev registered for rocket-crew (checked 2026-10-18T15:00:00.000Z)",
      "The catalogue now offers it as the game's tryUrl.",
    ]);
  });

  it("deploy:try with npm when there's no lockfile, or the lockfile's manager", async () => {
    registered();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { "deploy:try": "x" } }));
    await run(["try"], io());
    writeFileSync(join(dir, "package-lock.json"), "{}");
    await run(["try"], io());
    writeFileSync(join(dir, "bun.lockb"), "");
    await run(["try"], io());
    expect(commands.map((c) => c.command)).toEqual([
      "npm run deploy:try",
      "npm run deploy:try",
      "bun run deploy:try",
    ]);
  });

  it("an empty --command runs deploy:try", async () => {
    registered();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { "deploy:try": "x" } }));
    await run(["try", "--command", ""], io());
    expect(commands.map((c) => c.command)).toEqual(["npm run deploy:try"]);
  });

  it("no package.json, or one without deploy:try (or with scripts that aren't strings)", async () => {
    const msg = `No "deploy:try" script in ${join(dir, "package.json")}. Add one that deploys your try-kit Worker (e.g. "deploy:try": "wrangler deploy -c wrangler.try.jsonc"), or pass --command "...".`;
    expect(await run(["try"], io())).toBe(1);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "x" } }));
    expect(await run(["try"], io())).toBe(1);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { "deploy:try": 1 } }));
    expect(await run(["try"], io())).toBe(1);
    writeFileSync(join(dir, "package.json"), JSON.stringify({}));
    expect(await run(["try"], io())).toBe(1);
    expect(err).toEqual([msg, msg, msg, msg]);
    expect(commands).toEqual([]);
  });

  it("without io.cwd, the process's folder", async () => {
    registered();
    const { cwd: _, ...noCwd } = io();
    await run(["try", "--command", "make"], noCwd);
    expect(commands).toEqual([{ command: "make", cwd: process.cwd() }]);
  });

  it("prefers a workers.dev URL anywhere in the output, but only on workers.dev itself", async () => {
    registered();
    deployed = {
      code: 0,
      output: "https://a.workers.dev.evil.test/x then https://b.workers.dev/ then https://c.test",
    };
    await run(["try", "--command", "make"], io());
    expect(requests.at(-1)?.body).toEqual({ url: "https://b.workers.dev/" });
  });

  it("a workers.dev URL inside another URL doesn't count", async () => {
    registered();
    deployed = {
      code: 0,
      output: "https://b.workers.dev then https://c.test/?next=https://d.workers.dev/",
    };
    await run(["try", "--command", "make"], io());
    expect(requests.at(-1)?.body).toEqual({ url: "https://b.workers.dev" });
  });
});

describe("ogs manifest check", () => {
  const manifest = {
    appId: "comet-catch",
    name: "Comet Catch",
    shape: "couch",
    tv: "optional",
    startUrl: "https://comet.example/",
    art: { tile: "https://comet.example/tile.jpg" },
  };
  const file = () => {
    const p = join(dir, "m.json");
    writeFileSync(p, JSON.stringify(manifest));
    return p;
  };
  const answer = (over: object) => () =>
    Response.json({ valid: true, issues: [], warnings: [], checked: {}, ...over });

  it("nothing checked live: no checked line", async () => {
    routes[`POST ${API}/api/v1/manifests/check`] = answer({});
    expect(await run(["manifest", "check", file()], io())).toBe(0);
    expect(out).toEqual(["valid: comet-catch has no issues"]);
  });

  it("only the start URL checked, and one warning", async () => {
    routes[`POST ${API}/api/v1/manifests/check`] = answer({
      checked: { startUrl: 200 },
      warnings: [{ code: "w", message: "m" }],
    });
    await run(["manifest", "check", file()], io());
    expect(out).toEqual([
      "warning w: m",
      "checked: startUrl 200",
      "valid: comet-catch has no issues (1 warning)",
    ]);
  });

  it("two warnings", async () => {
    routes[`POST ${API}/api/v1/manifests/check`] = answer({
      checked: { tvUrl: 404, frameable: false },
      warnings: [
        { code: "a", message: "1" },
        { code: "b", message: "2" },
      ],
    });
    await run(["manifest", "check", file()], io());
    expect(out.slice(-2)).toEqual([
      "checked: tvUrl 404, framed by the OGS launcher: no",
      "valid: comet-catch has no issues (2 warnings)",
    ]);
  });

  it("one issue, and a root issue", async () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, "[]");
    expect(await run(["manifest", "check", p], io())).toBe(1);
    expect(err[0]).toMatch(/^issue \(root\): /);
    expect(err.at(-1)).toBe("invalid: 1 issue");
  });

  it("the API's errors: code and message, a body that isn't JSON, no body", async () => {
    routes[`POST ${API}/api/v1/manifests/check`] = () =>
      Response.json({ error: { code: "rate_limited" } }, { status: 429 });
    expect(await run(["manifest", "check", file()], io())).toBe(1);
    routes[`POST ${API}/api/v1/manifests/check`] = () => new Response("<html>", { status: 502 });
    expect(await run(["manifest", "check", file()], io())).toBe(1);
    routes[`POST ${API}/api/v1/manifests/check`] = () => new Response(null, { status: 503 });
    expect(await run(["manifest", "check", file()], io())).toBe(1);
    expect(err).toEqual(["rate_limited:", "HTTP 502", "HTTP 503"]);
    expect(requests[0]).toEqual({
      method: "POST",
      url: `${API}/api/v1/manifests/check`,
      body: manifest,
    });
  });
});

describe("ogs publish --status", () => {
  beforeEach(loggedIn);
  it("pending without a submitted time prints none", async () => {
    routes[`GET ${API}/api/v1/apps/rocket-crew/catalogue-entry`] = () =>
      Response.json({ appId: "rocket-crew", status: "pending" });
    expect(await run(["publish", "--status"], io())).toBe(0);
    expect(out).toEqual(["rocket-crew: pending review (submitted )"]);
  });
});
