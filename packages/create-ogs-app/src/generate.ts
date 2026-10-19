import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Answers } from "./options";
import { type PlaceholderValues, placeholderValues, renderTemplate } from "./placeholders";
import { planFiles } from "./plan";
import { drawAsset } from "./png";
import { valuesForFile, withoutEmptyTeamIds } from "./team-id";

/** The template ships next to src/ and dist/ (package files: dist, template). */
export const TEMPLATE_DIR = fileURLToPath(new URL("../template/", import.meta.url));

export class TargetNotEmptyError extends Error {
  constructor(readonly dir: string) {
    super(`${dir} is not empty: pick a new directory`);
    this.name = "TargetNotEmptyError";
  }
}

/** Every file in the template, relative and `/`-separated. */
export async function listTemplate(templateDir: string): Promise<string[]> {
  const entries = await readdir(templateDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(templateDir, join(e.parentPath, e.name)).split("\\").join("/"));
}

/** Writes the app into `targetDir` (missing or empty). Returns the files written, in order. */
export async function generateApp(opts: {
  targetDir: string;
  answers: Answers;
  templateDir?: string;
}): Promise<string[]> {
  const { targetDir, answers } = opts;
  const templateDir = opts.templateDir ?? TEMPLATE_DIR;
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    throw new TargetNotEmptyError(targetDir);
  }
  const values = placeholderValues(answers);
  const plan = planFiles(await listTemplate(templateDir), answers);
  // Render everything before writing anything: a broken template leaves no half-made app.
  const contents = await Promise.all(
    plan.map(async (file) =>
      file.source.kind === "asset"
        ? drawAsset(file.source.asset, values.BRAND_COLOR)
        : renderFile(file.to, await readFile(join(templateDir, file.source.from), "utf8"), values),
    ),
  );
  for (const [i, file] of plan.entries()) {
    const to = join(targetDir, file.to);
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, contents[i] ?? "");
  }
  return plan.map((f) => f.to);
}

function renderFile(to: string, text: string, values: PlaceholderValues): string {
  const rendered = renderTemplate(text, valuesForFile(to, values));
  return to === "eas.json" ? withoutEmptyTeamIds(rendered) : rendered;
}
