import { z } from "zod";

/**
 * Every file a package.json points at (main, module, types, typings, react-native, source, bin and
 * every exports target), as package-relative paths without "./". Wildcard exports ("./src/*.ts")
 * are returned as their directory with a trailing "/" (some file must be under it).
 */
const PathMapSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.null(), z.array(PathMapSchema), z.record(z.string(), PathMapSchema)]),
);

const PackageJsonSchema = z.object({
  name: z.string(),
  main: z.string().optional(),
  module: z.string().optional(),
  types: z.string().optional(),
  typings: z.string().optional(),
  "react-native": z
    .union([z.string(), z.record(z.string(), z.union([z.string(), z.literal(false)]))])
    .optional(),
  source: z.string().optional(),
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  exports: PathMapSchema.optional(),
});

function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

const normalise = (p: string) => {
  const path = p.replace(/^\.\//, "");
  const star = path.indexOf("*");
  return star === -1 ? path : path.slice(0, path.lastIndexOf("/", star) + 1);
};

export function packageJsonTargets(json: unknown): { name: string; targets: string[] } {
  const pkg = PackageJsonSchema.parse(json);
  const rn = pkg["react-native"];
  const found = [
    pkg.main,
    pkg.module,
    pkg.types,
    pkg.typings,
    pkg.source,
    ...(typeof rn === "string" ? [rn] : leaves(rn ?? {})),
    ...leaves(pkg.bin ?? {}),
    ...leaves(pkg.exports ?? {}).filter((p) => p !== "./package.json"),
  ].filter((p): p is string => typeof p === "string" && p !== "");
  return { name: pkg.name, targets: [...new Set(found.map(normalise))].sort() };
}

/** The targets missing from a tarball's file list (paths relative to the package root). */
export function missingTargets(targets: readonly string[], files: readonly string[]): string[] {
  const set = new Set(files);
  return targets.filter((t) =>
    t.endsWith("/") ? !files.some((f) => f.startsWith(t)) : !set.has(t),
  );
}
