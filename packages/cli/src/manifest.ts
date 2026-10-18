import { type Manifest, ManifestSchema } from "@open-game-system/ogs-protocol";
import { z } from "zod";
import { api, CliError, type Io } from "./io";

/**
 * The game's ogs.manifest.json, shared by ogs manifest check and ogs publish: read, parsed and
 * validated locally with ManifestSchema (no network), its issues printed by path.
 */
export const MANIFEST_FILE = "ogs.manifest.json";

export type Issue = { path: string; message: string };

/** The file as JSON: a CliError naming the file when it's missing or isn't JSON. */
export function readManifestJson(io: Io, file: string): unknown {
  let text: string;
  try {
    text = io.readFile(file);
  } catch {
    throw new CliError(
      `Can't read ${file}. Run this in the game's repo, or pass the manifest's path.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`${file} isn't JSON`);
  }
}

export function validate(raw: unknown): { manifest: Manifest } | { issues: Issue[] } {
  const parsed = ManifestSchema.safeParse(raw);
  return parsed.success
    ? { manifest: parsed.data }
    : { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** Prints each issue and the count to stderr; the exit code (1). */
export function printIssues(io: Io, issues: Issue[]): number {
  for (const i of issues) io.stderr(`issue ${i.path || "(root)"}: ${i.message}`);
  io.stderr(`invalid: ${issues.length} issue${issues.length === 1 ? "" : "s"}`);
  return 1;
}

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

/** POST to a public endpoint (no key); throws a CliError with the API's error code on failure. */
export async function postPublic(io: Io, path: string, body: unknown): Promise<unknown> {
  const res = await io.fetch(`${api(io)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let raw: unknown = {};
    try {
      raw = JSON.parse(text);
    } catch {}
    const parsed = ErrorBodySchema.safeParse(raw);
    throw new CliError(
      parsed.success
        ? `${parsed.data.error.code}: ${parsed.data.error.message ?? ""}`.trim()
        : `HTTP ${res.status}`,
    );
  }
  return JSON.parse(text);
}
