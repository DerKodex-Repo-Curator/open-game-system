import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIO, runCli } from "./cli";
import { InputEndedError } from "./line-prompt";

function io(ask: CliIO["ask"]) {
  const err: string[] = [];
  const out: string[] = [];
  const value: CliIO = {
    cwd: mkdtempSync(join(tmpdir(), "create-ogs-app-cli-")),
    ask,
    log: (m) => out.push(m),
    error: (m) => err.push(m),
  };
  return { value, err, out };
}

describe("runCli", () => {
  it("passes main's exit code through", async () => {
    const { value, out } = io(async () => "");
    expect(await runCli(["--help"], value)).toBe(0);
    expect(out.join("")).toContain("Usage:");
  });

  it("input that ends before the questions do: exit 2, says so", async () => {
    const { value, err } = io(() => Promise.reject(new InputEndedError()));
    expect(await runCli([], value)).toBe(2);
    expect(err.join("\n")).toMatch(/input ended/);
  });

  it("anything else that breaks: exit 1 with the error", async () => {
    const { value, err } = io(() => Promise.reject(new Error("disk on fire")));
    expect(await runCli([], value)).toBe(1);
    expect(err.join("\n")).toMatch(/disk on fire/);
  });
});
