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

  it("generating into the current directory says so", async () => {
    const { value, out } = io(async () => "");
    const code = await runCli(
      [
        ".",
        "--app-id",
        "rocket-crew",
        "--game-url",
        "https://rocketcrew.tv/p",
        "--team-id",
        "34S957HD77",
        "-y",
      ],
      value,
    );
    expect(code).toBe(0);
    expect(out[0]).toMatch(/^Made Rocket Crew \(\d+ files\)\.\n$/);
    expect(out[1]).toContain("Your app is in .");
  });

  it("a broken template is a crash (exit 1 with the stack), not a refusal", async () => {
    const { value, err } = io(async () => "");
    const code = await runCli(
      [
        "app",
        "--app-id",
        "rocket-crew",
        "--game-url",
        "https://rocketcrew.tv/p",
        "--team-id",
        "34S957HD77",
        "-y",
      ],
      { ...value, templateDir: join(value.cwd, "no-template") },
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/ENOENT[\s\S]*\n\s+at /);
  });
});
