import { describe, expect, it } from "vitest";
import type { DevOptions, DevServer } from "../dev/server";
import { lanAddress } from "../dev/server";
import type { Io } from "../io";
import { runDev, untilInterrupted } from "./dev";

/**
 * `ogs dev`'s options and what it prints, with a stand-in dev server (dev.test.ts and
 * dev/server.test.ts run the real one).
 */
const MANIFEST = {
  appId: "fixture-game",
  name: "Fixture Game",
  shape: "couch",
  tv: "required",
  startUrl: "http://localhost:5173/play",
  tvUrl: "http://localhost:5173/tv",
  art: { tile: "/tile.png" },
};

function setup(manifest: unknown = MANIFEST) {
  const out: string[] = [];
  const err: string[] = [];
  const read: string[] = [];
  const started: DevOptions[] = [];
  let closed = 0;
  const io: Io = {
    env: {},
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: (p) => {
      read.push(p);
      return JSON.stringify(manifest);
    },
    fetch,
  };
  const server = (over: Partial<DevServer> = {}): DevServer => ({
    url: "http://localhost:4747",
    jwksUrl: "http://localhost:4747/.well-known/jwks.json",
    phoneUrls: ["http://localhost:4748/play", "http://localhost:4749/play"],
    lanUrls: null,
    close: async () => {
      closed++;
    },
    ...over,
  });
  const dev = (args: string[], over: Partial<DevServer> = {}) =>
    runDev(
      io,
      args,
      async () => {},
      async (opts) => {
        started.push(opts);
        return server(over);
      },
    );
  return { io, out, err, read, started, dev, closed: () => closed };
}

const USAGE =
  "Usage: ogs dev [--manifest ogs.manifest.json] [--start-url <url>] [--tv-url <url>] [--port 4747] [--phones 2] [--lan <ip>]\n(--phones is 1 to 6; URLs are http or https)";

describe("ogs dev options", () => {
  it("defaults: ogs.manifest.json, port 4747, 2 phones, the manifest's URLs, this machine's LAN", async () => {
    const s = setup();
    expect(await s.dev([])).toBe(0);
    expect(s.read).toEqual(["ogs.manifest.json"]);
    expect(s.started).toHaveLength(1);
    expect(s.started[0]).toMatchObject({
      port: 4747,
      phones: 2,
      startUrl: "http://localhost:5173/play",
      tvUrl: "http://localhost:5173/tv",
      lan: lanAddress(),
    });
    expect(s.started[0].manifest.appId).toBe("fixture-game");
    expect(s.closed()).toBe(1);
  });

  it("flags win over the manifest", async () => {
    const s = setup();
    await s.dev([
      "--manifest",
      "game.json",
      "--port",
      "5000",
      "--phones",
      "6",
      "--start-url",
      "https://a.test/p",
      "--tv-url",
      "http://a.test/t",
      "--lan",
      "10.0.0.9",
    ]);
    expect(s.read).toEqual(["game.json"]);
    expect(s.started[0]).toMatchObject({
      port: 5000,
      phones: 6,
      startUrl: "https://a.test/p",
      tvUrl: "http://a.test/t",
      lan: "10.0.0.9",
    });
  });

  it("prints the harness, the phones, the LAN and the JWKS URL", async () => {
    const s = setup();
    await s.dev(["--lan", "10.0.0.7"], {
      lanUrls: {
        harness: "http://10.0.0.7:4747",
        phones: [],
        start: "http://10.0.0.7:5173/play",
      },
    });
    expect(s.out).toEqual([
      `ogs dev: Fixture Game (fixture-game)

  Harness   http://localhost:4747   (TV page + 2 phones: open this)
  TV page   http://localhost:5173/tv
  Phone 1   http://localhost:4748/play
  Phone 2   http://localhost:4749/play

  Real phones on this Wi-Fi: scan the QR codes in the harness (http://10.0.0.7:4747).
  Your game's dev server must listen on the LAN too (vite --host) for http://10.0.0.7:5173/play.

  Game server: verify tokens with OGS_JWKS_URL=http://localhost:4747/.well-known/jwks.json
  Ctrl-C stops.`,
    ]);
  });

  it("one phone, no TV page, no LAN", async () => {
    const { tvUrl: _, ...noTv } = MANIFEST;
    const s = setup(noTv);
    await s.dev(["--phones", "1"], { phoneUrls: ["http://localhost:4748/play"] });
    expect(s.out).toEqual([
      `ogs dev: Fixture Game (fixture-game)

  Harness   http://localhost:4747   (TV page + 1 phone: open this)
  TV page   none yet: a phone sends it with cast-kit useCastViewUrl
  Phone 1   http://localhost:4748/play

  No LAN address: real phones can't reach this machine.

  Game server: verify tokens with OGS_JWKS_URL=http://localhost:4747/.well-known/jwks.json
  Ctrl-C stops.`,
    ]);
  });

  it.each([
    [["--port=-1"]],
    [["--port", "65530"]],
    [["--port", "1.5"]],
    [["--phones", "0"]],
    [["--phones", "7"]],
    [["--phones", "1.5"]],
    [["--start-url", "ftp://a.test/"]],
    [["--start-url", "xhttp://a.test/"]],
    [["--tv-url", "http://a.test/", "--start-url", "mailto:x"]],
    [["--tv-url", "httpsx://a.test/"]],
  ])("%j is a usage error (exit 2), and nothing starts", async (args) => {
    const s = setup();
    expect(await s.dev(args)).toBe(2);
    expect(s.err).toEqual([USAGE]);
    expect(s.started).toEqual([]);
  });

  it.each([
    [["--port", "0"]],
    [["--port", "65529"]],
    [["--phones", "1"]],
    [["--phones", "6"]],
    [["--start-url", "http://a.test/", "--tv-url", "https://a.test/t"]],
  ])("%j is fine", async (args) => {
    const s = setup();
    expect(await s.dev(args)).toBe(0);
    expect(s.err).toEqual([]);
  });

  it("a port in use says so; any other failure is passed on", async () => {
    const s = setup();
    const inUse = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    await expect(
      runDev(
        s.io,
        ["--port", "5000", "--phones", "3"],
        async () => {},
        async () => {
          throw inUse;
        },
      ),
    ).rejects.toThrow(
      "Port 5000 (or one of the 3 after it, for the phones) is in use. Pass --port <another>.",
    );
    const other = Object.assign(new Error("listen EACCES"), { code: "EACCES" });
    await expect(
      runDev(
        s.io,
        [],
        async () => {},
        async () => {
          throw other;
        },
      ),
    ).rejects.toBe(other);
    const noCode = new Error("EADDRINUSE in the message only");
    await expect(
      runDev(
        s.io,
        [],
        async () => {},
        async () => {
          throw noCode;
        },
      ),
    ).rejects.toBe(noCode);
    const notError = { code: "EADDRINUSE" };
    await expect(
      runDev(
        s.io,
        [],
        async () => {},
        async () => {
          throw notError;
        },
      ),
    ).rejects.toBe(notError);
  });

  it("names a manifest's issues by path ((root) for the whole file)", async () => {
    const s = setup([]);
    await expect(s.dev([])).rejects.toThrow(
      /^ogs\.manifest\.json is not a valid manifest:\n {2}\(root\): .+$/,
    );
    const t = setup({ ...MANIFEST, art: { tile: 1 } });
    await expect(t.dev([])).rejects.toThrow(
      /^ogs\.manifest\.json is not a valid manifest:\n {2}art\.tile: [^\n]+$/,
    );
    const u = setup({ ...MANIFEST, startUrl: 1, name: 2 });
    await expect(u.dev([])).rejects.toThrow(/manifest:\n {2}[^\n]+\n {2}[^\n]+$/);
  });

  it("serves until Ctrl-C or SIGTERM", async () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      let done = false;
      const waiting = untilInterrupted().then(() => {
        done = true;
      });
      await Promise.resolve();
      expect(done).toBe(false);
      process.emit(signal);
      await waiting;
      expect(done).toBe(true);
    }
  });
});
