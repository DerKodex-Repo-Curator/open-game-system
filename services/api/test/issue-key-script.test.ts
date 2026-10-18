import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hashApiKey } from "../src/lib/api-keys";

/** scripts/issue-key.mjs must store exactly what the API's key check hashes. */
const run = (...args: string[]) =>
  execFileSync("node", ["scripts/issue-key.mjs", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

describe("issue-key", () => {
  it("prints a key and an insert of its hash, prefix and scope (--dry)", async () => {
    const { key, sql } = z
      .object({ key: z.string(), sql: z.string() })
      .parse(JSON.parse(run("codebreakers", "--dry")));
    expect(key).toMatch(/^ogsk_[A-Za-z0-9_-]{43}$/);
    expect(sql).toContain(
      `'codebreakers', '${key.slice(0, 12)}', '${await hashApiKey(key)}', 'notifications:send'`,
    );
    expect(sql).not.toContain(key.slice(12));
  });

  it("refuses an appId that isn't one", () => {
    expect(() => run("Bad App'; DROP", "--dry")).toThrow();
    expect(() => run("--dry")).toThrow();
  });
});
