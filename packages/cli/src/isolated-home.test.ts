import { homedir, tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { configDir } from "./io";

describe("tests run with a throwaway home (test/isolated-home.ts)", () => {
  it("homedir() and the default config dir are under the temp dir, never the real home", () => {
    expect(homedir().startsWith(tmpdir())).toBe(true);
    expect(homedir()).toContain("ogs-test-home-");
    const dir = configDir({
      env: {},
      stdout: () => {},
      stderr: () => {},
      readFile: () => "",
      fetch,
    });
    expect(dir.startsWith(tmpdir())).toBe(true);
  });
});
