import { parseArgs } from "node:util";
import { z } from "zod";
import type { Io } from "../io";
import { MANIFEST_FILE, postPublic, printIssues, readManifestJson, validate } from "../manifest";

const CheckSchema = z.object({
  valid: z.boolean(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  checked: z.object({
    startUrl: z.number().optional(),
    tvUrl: z.number().optional(),
    frameable: z.boolean().optional(),
  }),
});

/** What the API's live checks saw, one line. */
function checkedLine(checked: z.infer<typeof CheckSchema>["checked"]): string | null {
  const parts = [
    checked.startUrl === undefined ? null : `startUrl ${checked.startUrl}`,
    checked.tvUrl === undefined ? null : `tvUrl ${checked.tvUrl}`,
    checked.frameable === undefined
      ? null
      : `framed by the OGS launcher: ${checked.frameable ? "yes" : "no"}`,
  ].filter((p) => p !== null);
  return parts.length > 0 ? `checked: ${parts.join(", ")}` : null;
}

/**
 * ogs manifest check [file] [--offline]: the schema locally (no network), then the API's check
 * (POST /api/v1/manifests/check: catalogue rules and live checks of the pages). Issues exit 1;
 * warnings are printed and don't fail it.
 */
export async function check(io: Io, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { offline: { type: "boolean" } },
  });
  const file = positionals[0] ?? MANIFEST_FILE;
  const raw = readManifestJson(io, file);
  const local = validate(raw);
  if ("issues" in local) return printIssues(io, local.issues);
  const { appId } = local.manifest;
  if (values.offline) {
    io.stdout(`valid: ${appId} has no schema issues (offline: no catalogue rules or live checks)`);
    return 0;
  }
  const result = CheckSchema.parse(await postPublic(io, "/api/v1/manifests/check", raw));
  if (!result.valid) return printIssues(io, result.issues);
  printValid(io, appId, result);
  return 0;
}

/** The API's warnings, what its live checks saw, and the verdict. */
function printValid(io: Io, appId: string, result: z.infer<typeof CheckSchema>) {
  for (const w of result.warnings) io.stdout(`warning ${w.code}: ${w.message}`);
  const line = checkedLine(result.checked);
  if (line) io.stdout(line);
  const n = result.warnings.length;
  io.stdout(`valid: ${appId} has no issues${n > 0 ? ` (${n} warning${n === 1 ? "" : "s"})` : ""}`);
}
