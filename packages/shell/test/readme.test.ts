import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ShellConfigSchema } from "../plugin/src/shell-config";

/** The package README is what a game developer or maintainer follows: it must match the code. */
const ROOT = resolve(__dirname, "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

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

describe("the shell README", () => {
  it("puts each command in its own bash block, ready to copy", () => {
    const blocks = bashBlocks(readme);
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks) expect(block, block.join(" | ")).toHaveLength(1);
  });

  it("lists every plugin option in its table", () => {
    for (const key of Object.keys(ShellConfigSchema.shape))
      expect(readme).toContain(`| \`${key}\` |`);
  });

  it("names every testID the shell's screens have", () => {
    const src = join(ROOT, "src");
    const ids = readdirSync(src)
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) => [...readFileSync(join(src, f), "utf8").matchAll(/testID="([^"]+)"/g)])
      .map((m) => m[1] ?? "");
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(readme).toContain(`\`${id}\``);
  });

  it("names the test scripts it tells maintainers to run", () => {
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    for (const [, script] of readme.matchAll(/--filter @open-game-system\/shell ([\w:]+)/g))
      expect(pkg).toContain(`"${script}":`);
  });
});
