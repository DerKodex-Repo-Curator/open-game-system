import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIO, main } from "../src/cli";

/** The generated README is what a developer new to OGS follows, command by command. */
async function readme(teamId: string): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), "create-ogs-app-readme-"));
  const io: CliIO = { cwd, ask: async () => "", log: () => {}, error: () => {} };
  const flags = ["--app-id", "my-game", "--game-url", "https://my-game.example.workers.dev/host"];
  const code = await main(
    ["app", ...flags, "--bundle-id", "com.example.mygame", "--team-id", teamId, "--yes"],
    io,
  );
  expect(code).toBe(0);
  return readFileSync(join(cwd, "app/README.md"), "utf8");
}

/** Every ```bash block's commands: one per line, a trailing `\` continues it. */
function bashBlocks(text: string): string[][] {
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) =>
    (m[1] ?? "")
      .replace(/\\\n/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );
}

describe("the generated README", () => {
  it("puts each command in its own bash block, ready to copy", async () => {
    const blocks = bashBlocks(await readme("-"));
    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) expect(block, block.join(" | ")).toHaveLength(1);
  });

  it("starts with the simulator: install, then pnpm ios, before any account", async () => {
    const text = await readme("-");
    const install = text.indexOf("```bash\npnpm install");
    const ios = text.indexOf("```bash\npnpm ios");
    const login = text.indexOf("```bash\nogs login");
    const eas = text.indexOf("```bash\neas login");
    expect(install).toBeGreaterThan(-1);
    expect(ios).toBeGreaterThan(install);
    expect(login).toBeGreaterThan(ios);
    expect(eas).toBeGreaterThan(ios);
  });

  it("says what works with no account and what needs ogs login, Apple or EAS", async () => {
    const text = await readme("-");
    expect(text).toMatch(/## What needs an account/);
    for (const needed of ["No account", "Apple Developer", "ogs login", "EAS"]) {
      expect(text).toContain(needed);
    }
  });

  it("covers what a first run meets: CocoaPods, the build time, choosing a simulator, Expo's menu", async () => {
    const text = await readme("-");
    expect(text).toContain("CocoaPods");
    expect(text).toMatch(/first build takes/i);
    expect(text).toContain("pnpm ios --device");
    expect(text).toMatch(/developer menu[\s\S]*Continue/);
  });

  it("explains profile null before the game is in the OGS catalogue", async () => {
    const text = await readme("-");
    expect(text).toMatch(/not in the OGS catalogue/);
    expect(text).toContain("art-and-catalogue#submit-to-the-catalogue");
  });

  it("without a Team ID, says where to put it later; with one, the commands carry it", async () => {
    expect(await readme("-")).toContain("ios.appleTeamId");
    expect(await readme("34S957HD77")).toContain("--team-id 34S957HD77");
  });
});
