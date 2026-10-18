import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Io, run } from "../cli";
import { deployedUrl, packageManager } from "./try";

/**
 * `ogs try` and `ogs push send` (docs/design-docs/ogs-cli.md, deliver) against a stand-in API at
 * fetch and a fake process runner. services/api/test/cli-deliver.test.ts runs them against the real API.
 */
const API = "https://api.test";
const KEY = "ogsk_test_rocketcrew";
const TRY = "https://rocket-crew-try.jon.workers.dev";
const H1 = "ph_aaaaaaaaaaaaaaaa";
const H2 = "ph_bbbbbbbbbbbbbbbb";
let home: string;
let repo: string;
let out: string[];
let err: string[];
let requests: { method: string; url: string; body: unknown }[];
let routes: Record<string, (body: unknown) => Response>;
let commands: { command: string; cwd: string }[];
let deploy: { code: number; output: string };

function io(over: Partial<Io> = {}): Io {
  return {
    env: { OGS_API: API, OGS_CONFIG_DIR: home },
    cwd: repo,
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
      return deploy;
    },
    ...over,
  };
}

const wranglerOutput = `
 ⛅️ wrangler 4.42.0
───────────────────
Total Upload: 88.21 KiB / gzip: 21.30 KiB
Uploaded rocket-crew-try (3.21 sec)
Deployed rocket-crew-try triggers (0.84 sec)
  \u001b[36m${TRY}\u001b[39m
Current Version ID: 0f3c2a8e-1b2c-4d5e-8f90-123456789abc
`;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "ogs-home-"));
  repo = mkdtempSync(join(tmpdir(), "ogs-repo-"));
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { "deploy:try": "wrangler deploy -c wrangler.try.jsonc" } }),
  );
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  out = [];
  err = [];
  requests = [];
  commands = [];
  deploy = { code: 0, output: wranglerOutput };
  routes = {
    [`GET ${API}/api/v1/apps/rocket-crew/native`]: () => Response.json({ apps: [] }),
    [`PUT ${API}/api/v1/apps/rocket-crew/try`]: (b) =>
      Response.json({
        appId: "rocket-crew",
        url: z(b).url,
        checkedAt: "2026-10-18T15:00:00.000Z",
      }),
  };
  expect(await run(["login", "--app", "rocket-crew", "--key", KEY], io())).toBe(0);
  out = [];
  requests = [];
});

/** The test's own view of a JSON body it sent. */
const z = (b: unknown): { url: string } => {
  if (typeof b === "object" && b !== null && "url" in b && typeof b.url === "string")
    return { url: b.url };
  throw new Error("no url");
};

describe("ogs try", () => {
  it("runs deploy:try with the repo's package manager, reads the URL and registers it", async () => {
    expect(await run(["try"], io())).toBe(0);
    expect(commands).toEqual([{ command: "pnpm run deploy:try", cwd: repo }]);
    expect(requests).toEqual([
      { method: "PUT", url: `${API}/api/v1/apps/rocket-crew/try`, body: { url: TRY } },
    ]);
    expect(out.join("\n")).toContain(`ok   try path ${TRY} registered for rocket-crew`);
    expect(err).toEqual([]);
  });

  it("--command runs that instead, and --url says where it went", async () => {
    deploy = { code: 0, output: "done\n" };
    const url = "https://try.rocket-crew.example";
    expect(await run(["try", "--command", "make deploy-try", "--url", url], io())).toBe(0);
    expect(commands).toEqual([{ command: "make deploy-try", cwd: repo }]);
    expect(requests[0]?.body).toEqual({ url });
  });

  it("--check-only --url checks and registers without deploying", async () => {
    expect(await run(["try", "--check-only", "--url", TRY], io())).toBe(0);
    expect(commands).toEqual([]);
    expect(requests[0]?.body).toEqual({ url: TRY });
  });

  it("--check-only alone re-checks the registered try path", async () => {
    routes[`GET ${API}/api/v1/apps/rocket-crew/try`] = () =>
      Response.json({ appId: "rocket-crew", url: TRY, checkedAt: "2026-10-17T15:00:00.000Z" });
    expect(await run(["try", "--check-only"], io())).toBe(0);
    expect(commands).toEqual([]);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${API}/api/v1/apps/rocket-crew/try`,
      `PUT ${API}/api/v1/apps/rocket-crew/try`,
    ]);
  });

  it("a failed check: the API's code and which check failed, exit 1", async () => {
    routes[`PUT ${API}/api/v1/apps/rocket-crew/try`] = () =>
      Response.json(
        {
          error: {
            code: "try_path_not_found",
            message: "GET https://example.com/ answered 200, not a redirect to a TV page",
            status: 422,
          },
        },
        { status: 422 },
      );
    expect(await run(["try", "--url", "https://example.com", "--check-only"], io())).toBe(1);
    expect(err.join("\n")).toBe(
      "try_path_not_found: GET https://example.com/ answered 200, not a redirect to a TV page",
    );
  });

  it("a deploy that fails stops before registering", async () => {
    deploy = { code: 3, output: "✘ [ERROR] Authentication error\n" };
    expect(await run(["try"], io())).toBe(1);
    expect(requests).toEqual([]);
    expect(err.join("\n")).toContain("pnpm run deploy:try failed (exit 3)");
  });

  it("output with no https URL: says to pass --url", async () => {
    deploy = { code: 0, output: "Deployed.\n" };
    expect(await run(["try"], io())).toBe(1);
    expect(requests).toEqual([]);
    expect(err.join("\n")).toContain("--url");
  });

  it("no deploy:try script: says what to add", async () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    expect(await run(["try"], io())).toBe(1);
    expect(commands).toEqual([]);
    expect(err.join("\n")).toContain('"deploy:try"');
  });

  it("without a process runner it can only check", async () => {
    expect(await run(["try"], io({ exec: undefined }))).toBe(1);
    expect(err.join("\n")).toContain("--check-only");
  });
});

describe("finding the deployed URL and the package manager", () => {
  it("prefers the last workers.dev URL, without colour codes", () => {
    expect(deployedUrl(wranglerOutput)).toBe(TRY);
    expect(
      deployedUrl(
        `see https://developers.cloudflare.com/workers\n  ${TRY}\nhttps://dash.cloudflare.com/x`,
      ),
    ).toBe(TRY);
  });
  it("else the last https URL; none is null", () => {
    expect(deployedUrl("Live at https://try.example.com/ (and http://localhost:8787)")).toBe(
      "https://try.example.com/",
    );
    expect(deployedUrl("Deployed.")).toBeNull();
  });
  it("comes from the lockfile, npm when there is none", () => {
    const has = (name: string) => (f: string) => f === name;
    expect(packageManager(has("pnpm-lock.yaml"))).toBe("pnpm");
    expect(packageManager(has("yarn.lock"))).toBe("yarn");
    expect(packageManager(has("bun.lock"))).toBe("bun");
    expect(packageManager(has("bun.lockb"))).toBe("bun");
    expect(packageManager(has("package-lock.json"))).toBe("npm");
    expect(packageManager(() => false)).toBe("npm");
  });
});

describe("ogs push send", () => {
  const notifications = `POST ${API}/api/v1/games/rocket-crew/notifications`;
  beforeEach(() => {
    routes[notifications] = (b) => {
      const to =
        typeof b === "object" && b !== null && "to" in b && Array.isArray(b.to) ? b.to : [];
      return Response.json({
        results: to.map((h: unknown) => ({
          to: String(h),
          status: h === H1 ? "sent" : "not_permitted",
        })),
      });
    };
  });

  it("sends a test push and prints each handle's status", async () => {
    expect(
      await run(
        ["push", "send", "--to", H1, "--title", "Test", "--url", "https://comet.example/room/ABCD"],
        io(),
      ),
    ).toBe(0);
    expect(requests).toEqual([
      {
        method: "POST",
        url: `${API}/api/v1/games/rocket-crew/notifications`,
        body: {
          to: [H1],
          title: "Test",
          body: "A test push from ogs push send.",
          url: "https://comet.example/room/ABCD",
          whenOpen: "deliver",
        },
      },
    ]);
    expect(out).toEqual([`${H1}  sent`]);
  });

  it("a default title and body; several handles; one not sent exits 1", async () => {
    expect(await run(["push", "send", "--to", `${H1}, ${H2}`, "--when-open", "banner"], io())).toBe(
      1,
    );
    expect(requests[0]?.body).toEqual({
      to: [H1, H2],
      title: "Test push",
      body: "A test push from ogs push send.",
      whenOpen: "banner",
    });
    expect(out).toEqual([`${H1}  sent`, `${H2}  not_permitted`]);
  });

  it("--check lists each handle's surfaces without sending", async () => {
    routes[`GET ${API}/api/v1/games/rocket-crew/push-handles/${H1}`] = () =>
      Response.json({
        handle: H1,
        surfaces: [
          { kind: "web", lastActiveAt: "2026-10-18T12:00:00.000Z" },
          { kind: "ogs", lastActiveAt: "2026-10-18T10:00:00.000Z" },
        ],
      });
    routes[`GET ${API}/api/v1/games/rocket-crew/push-handles/${H2}`] = () =>
      Response.json({ handle: H2, surfaces: [] });
    expect(await run(["push", "send", "--to", `${H1},${H2}`, "--check"], io())).toBe(1);
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    expect(out).toEqual([
      `${H1}  web (last active 2026-10-18T12:00:00.000Z), then ogs (last active 2026-10-18T10:00:00.000Z)`,
      `${H2}  nowhere: no surface left (the player opts in again)`,
    ]);
  });

  it("--check of an unknown handle prints the API's error for it", async () => {
    routes[`GET ${API}/api/v1/games/rocket-crew/push-handles/${H1}`] = () =>
      Response.json(
        {
          error: {
            code: "handle_not_found",
            message: "No push handle with that id for this game",
            status: 404,
          },
        },
        { status: 404 },
      );
    expect(await run(["push", "send", "--to", H1, "--check"], io())).toBe(1);
    expect(out).toEqual([`${H1}  handle_not_found: No push handle with that id for this game`]);
  });

  it("usage errors exit 2", async () => {
    expect(await run(["push", "send"], io())).toBe(2);
    expect(await run(["push", "send", "--to", H1, "--when-open", "later"], io())).toBe(2);
    expect(requests).toEqual([]);
  });

  it("the API's error (a url off the game's origin) exits 1", async () => {
    routes[notifications] = () =>
      Response.json(
        {
          error: { code: "invalid_body", message: "url must be on the game's origin", status: 400 },
        },
        { status: 400 },
      );
    expect(
      await run(["push", "send", "--to", H1, "--url", "https://elsewhere.example/"], io()),
    ).toBe(1);
    expect(err.join("\n")).toBe("invalid_body: url must be on the game's origin");
  });

  it("help lists both commands", async () => {
    await run(["--help"], io());
    const help = out.join("\n");
    expect(help).toContain("ogs try");
    expect(help).toContain("ogs push send --to <handle>");
  });
});
