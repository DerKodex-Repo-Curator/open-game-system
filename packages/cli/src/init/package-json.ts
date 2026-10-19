import { z } from "zod";
import { CliError } from "../io";

/**
 * Adds `file:vendor/…` dependencies to package.json's text, keeping its indentation and every other
 * field. A dependency the repo already has under another spec is left alone (and reported).
 */
const PackageSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
});

export type DependencyChange = {
  text: string;
  added: string[];
  kept: { name: string; spec: string }[];
};

/** package.json's fields (a new one: the name and private), or a CliError. */
function parsePackage(text: string | null, fallbackName: string) {
  try {
    return PackageSchema.parse(
      text === null ? { name: fallbackName, private: true } : JSON.parse(text),
    );
  } catch {
    throw new CliError("package.json isn't valid JSON with a dependencies object");
  }
}

/** The dependencies with `deps` added where missing; one already there under another spec is kept. */
function merge(current: Record<string, string>, deps: Record<string, string>) {
  const added: string[] = [];
  const kept: { name: string; spec: string }[] = [];
  const next = { ...current };
  for (const [name, spec] of Object.entries(deps)) {
    const existing = current[name];
    if (existing === undefined) {
      next[name] = spec;
      added.push(name);
    } else if (existing !== spec) kept.push({ name, spec: existing });
  }
  return { next, added, kept };
}

export function addDependencies(
  text: string | null,
  deps: Record<string, string>,
  fallbackName: string,
): DependencyChange {
  const parsed = parsePackage(text, fallbackName);
  const { next, added, kept } = merge(parsed.dependencies ?? {}, deps);
  if (added.length === 0 && text !== null) return { text, added, kept };
  const indent = text?.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  return {
    text: `${JSON.stringify({ ...parsed, dependencies: next }, null, indent)}\n`,
    added,
    kept,
  };
}
