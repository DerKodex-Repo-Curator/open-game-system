import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../cli";
import type { Io } from "../io";
import { runDev } from "./dev";

let dir: string;
let out: string[];
let err: string[];
const io = (): Io => ({
  env: {},
  stdout: (s) => out.push(s),
  stderr: (s) => err.push(s),
  readFile: (p) => readFileSync(p, "utf8"),
  fetch,
});

const MANIFEST = {
  appId: "fixture-game",
  name: "Fixture Game",
  shape: "couch",
  tv: "required",
  startUrl: "http://localhost:5173/play",
  tvUrl: "http://localhost:5173/tv",
  art: { tile: "/tile.png" },
};
const writeManifest = (m: unknown, name = "ogs.manifest.json") => {
  const path = join(dir, name);
  writeFileSync(path, typeof m === "string" ? m : JSON.stringify(m));
  return path;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ogs-dev-"));
  out = [];
  err = [];
});

describe("ogs dev", { timeout: 20_000 }, () => {
  it("serves the harness until stopped, then closes it, and exits 0", async () => {
    const path = writeManifest(MANIFEST);
    let harness = "";
    let status = 0;
    const code = await runDev(
      io(),
      ["--manifest", path, "--port", "0", "--lan", "10.0.0.7"],
      async (server) => {
        harness = server.url;
        const res = await fetch(server.url);
        status = res.status;
      },
    );
    expect(code).toBe(0);
    expect(status).toBe(200);
    const printed = out.join("\n");
    expect(printed).toContain(`Harness   ${harness}`);
    expect(printed).toContain("TV page   http://localhost:5173/tv");
    expect(printed).toMatch(/Phone 1 {3}http:\/\/localhost:\d+\/play/);
    expect(printed).toMatch(/Phone 2 {3}http:\/\/localhost:\d+\/play/);
    expect(printed).toContain("http://10.0.0.7:5173/play");
    expect(printed).toContain(`OGS_JWKS_URL=${harness}/.well-known/jwks.json`);
    await expect(fetch(harness)).rejects.toThrow();
  });

  it("uses --start-url and --tv-url over the manifest, and --phones", async () => {
    const path = writeManifest(MANIFEST);
    await runDev(
      io(),
      [
        "--manifest",
        path,
        "--port",
        "0",
        "--phones",
        "3",
        "--start-url",
        "http://localhost:9000/p?x=1",
        "--tv-url",
        "http://localhost:9000/t",
      ],
      async () => {},
    );
    const printed = out.join("\n");
    expect(printed).toContain("TV page   http://localhost:9000/t");
    expect(printed).toMatch(/Phone 3 {3}http:\/\/localhost:\d+\/p\?x=1/);
  });

  it("says a room-based game (no tvUrl) gets its TV page from a phone", async () => {
    const { tvUrl: _, ...noTv } = MANIFEST;
    const path = writeManifest(noTv);
    await runDev(io(), ["--manifest", path, "--port", "0"], async () => {});
    expect(out.join("\n")).toContain("TV page   none yet");
  });

  it("names the manifest's issues and exits 1", async () => {
    const path = writeManifest({ ...MANIFEST, startUrl: "not a url" });
    expect(await run(["dev", "--manifest", path], io())).toBe(1);
    expect(err.join("\n")).toMatch(/is not a valid manifest:\n {2}startUrl: /);
  });

  it("exits 1 with no manifest, or one that isn't JSON", async () => {
    expect(await run(["dev", "--manifest", join(dir, "missing.json")], io())).toBe(1);
    expect(err.join("\n")).toContain("No manifest at");
    expect(await run(["dev", "--manifest", writeManifest("{", "bad.json")], io())).toBe(1);
    expect(err.join("\n")).toContain("is not JSON");
  });

  it.each([
    [["--phones", "0"]],
    [["--phones", "7"]],
    [["--port", "abc"]],
    [["--start-url", "ftp://x/"]],
    [["--tv-url", "nope"]],
  ])("is a usage error (exit 2) for %j", async (args) => {
    expect(await run(["dev", ...args], io())).toBe(2);
    expect(err.join("\n")).toContain("Usage: ogs dev");
  });

  it("says which port is taken", async () => {
    const busy = http.createServer();
    await new Promise<void>((r) => busy.listen(0, () => r()));
    const addr = busy.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const path = writeManifest(MANIFEST);
      expect(await run(["dev", "--manifest", path, "--port", String(port)], io())).toBe(1);
      expect(err.join("\n")).toContain(`Port ${port}`);
    } finally {
      busy.close();
    }
  });

  it("is listed in ogs --help", async () => {
    await run(["--help"], io());
    expect(out.join("\n")).toContain("ogs dev [--manifest <file>]");
  });
});
