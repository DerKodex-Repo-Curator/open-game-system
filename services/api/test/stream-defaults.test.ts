import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The cast receiver (opengame.org/receiver) and the app fall back to one stream server when none
 * is named: this production Worker's stream route. (They pointed at a stale PR-preview Worker.) The
 * app's constant lives in the shell since the cast modules moved (apps/mobile re-exports it).
 */
const root = join(__dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const worker = /"name":\s*"([^"]+)"/.exec(read("services/api/wrangler.jsonc"))?.[1];
const mount = /app\.route\("([^"]+)", stream\)/.exec(read("services/api/src/index.ts"))?.[1];
const PRODUCTION_STREAM = `https://${worker}.jonathanrmumm.workers.dev${mount}`;

describe("the default stream server, receiver and app", () => {
  it("is this Worker's stream route", () => {
    expect(PRODUCTION_STREAM).toBe("https://opengame-api.jonathanrmumm.workers.dev/api/v1/stream");
  });

  it("is the receiver's default", () => {
    const receiver = read("apps/web/public/receiver.html");
    expect(/const DEFAULT_STREAM_SERVER = '([^']+)'/.exec(receiver)?.[1]).toBe(PRODUCTION_STREAM);
  });

  it("is the app's named production stream route", () => {
    const castView = read("packages/shell/src/cast-view.ts");
    expect(/export const OGS_STREAM_SERVER_URL = "([^"]+)"/.exec(castView)?.[1]).toBe(
      PRODUCTION_STREAM,
    );
  });

  it("no longer names a PR-preview Worker anywhere a cast starts", () => {
    for (const path of ["apps/web/public/receiver.html", "packages/shell/src/cast-view.ts"])
      expect(read(path)).not.toMatch(/opengame-api-pr-\d+/);
  });
});
