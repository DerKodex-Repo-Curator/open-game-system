import { join } from "node:path";
import { parseArgs } from "node:util";
import { findEntries, insertAfterImports, PHONE_SNIPPET, TV_SNIPPET } from "../init/codemod";
import {
  detectFramework,
  detectPackageManager,
  FRAMEWORK_NAMES,
  type Framework,
  installCommand,
} from "../init/detect";
import { downloadKit, fetchKits } from "../init/kits";
import { checkManifest, draftManifest, type Issue, type ManifestInput } from "../init/manifest";
import { type Entry, renderOgsMd } from "../init/ogs-md";
import { addDependencies } from "../init/package-json";
import { files, type Io } from "../io";

/**
 * `ogs init` (docs/design-docs/ogs-cli.md): adds OGS to an existing web game. It works out every
 * change first (downloading the kits), prints the plan, and only then writes, so a failure or
 * `--dry` leaves the repo as it was. It never runs the package manager.
 */
export const INIT_USAGE = [
  "ogs init [--app-id <id>] [--name <name>] [--start-url <url>] [--tv-url <url>]",
  "         [--shape couch|live|async] [--tv none|optional|required] [--codemod] [--dry]",
];

const OPTIONS = {
  "app-id": { type: "string" },
  name: { type: "string" },
  "start-url": { type: "string" },
  "tv-url": { type: "string" },
  shape: { type: "string" },
  tv: { type: "string" },
  codemod: { type: "boolean" },
  dry: { type: "boolean" },
} as const;

type Action =
  | { verb: "write" | "edit"; path: string; data: string | Uint8Array; note?: string }
  | { verb: "keep"; path: string; note?: string };

const QUESTIONS = [
  ["app-id", "appId (lowercase letters, digits and hyphens, e.g. space-bakery): "],
  ["name", "Game name: "],
  ["start-url", "Start URL (the phone page, https://…): "],
] as const;
const TV_QUESTION = "TV page URL (blank: none, the phone page declares it per room): ";

/** The manifest's fields from the flags, asking for what's missing at a terminal; 2 when it can't. */
async function manifestInput(
  io: Io,
  values: Partial<Record<keyof typeof OPTIONS, string | boolean>>,
): Promise<ManifestInput | 2> {
  const str = (k: keyof typeof OPTIONS) => {
    const v = values[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const got: Record<string, string | undefined> = {
    "app-id": str("app-id"),
    name: str("name"),
    "start-url": str("start-url"),
    "tv-url": str("tv-url"),
  };
  const missing = QUESTIONS.filter(([k]) => !got[k]);
  if (missing.length > 0 && io.isTTY && io.prompt) {
    for (const [k, q] of missing) got[k] = (await io.prompt(q)).trim() || undefined;
    if (!got["tv-url"]) got["tv-url"] = (await io.prompt(TV_QUESTION)).trim() || undefined;
  }
  const still = QUESTIONS.filter(([k]) => !got[k]).map(([k]) => `--${k}`);
  const [appId, name, startUrl] = [got["app-id"], got.name, got["start-url"]];
  if (!appId || !name || !startUrl) {
    io.stderr(
      `ogs init: missing ${still.join(", ")}${io.isTTY ? "" : " (no terminal to ask in)"}\n\nUsage: ${INIT_USAGE.join("\n")}`,
    );
    return 2;
  }
  return { appId, name, startUrl, tvUrl: got["tv-url"], shape: str("shape"), tv: str("tv") };
}

const issueLines = (issues: Issue[]) =>
  issues.map((i) => `  ${i.path || "(root)"}: ${i.message}`).join("\n");

const HOOKUP = { tv: "the TV page's launcher hookup", phone: "the phone page's profile hookup" };
const PAGE = { tv: "TV page", phone: "phone page" };

/** Where a snippet goes when ogs init won't place it itself. */
function whereItGoes(side: "tv" | "phone", framework: Framework, candidates: string[]) {
  const page = PAGE[side];
  if (framework === "next") return `add this in client code ("use client") of your ${page}`;
  if (framework === "tanstack-start")
    return `add this in client-only code (inside useEffect) of your ${page}`;
  if (framework === "plain")
    return `add this to your ${page}'s module script once a bundler or an import map can load the kits (OGS.md)`;
  if (candidates.length > 1) return `add this to one of ${candidates.join(", ")}`;
  return `add this at the top of the module that boots your ${page}`;
}

export async function init(io: Io, args: string[]): Promise<number> {
  let values: Partial<Record<keyof typeof OPTIONS, string | boolean>>;
  try {
    values = parseArgs({ args, options: OPTIONS }).values;
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n\nUsage: ${INIT_USAGE.join("\n")}`);
    return 2;
  }
  const fs = files(io);
  const root = fs.cwd;
  const at = (path: string) => join(root, path);
  const actions: Action[] = [];
  const notes: string[] = [];

  // 1. The manifest: the repo's own, or one from the flags / prompts.
  let manifest: { appId: string; name: string; startUrl: string; tvUrl?: string };
  if (fs.exists(at("ogs.manifest.json"))) {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.read(at("ogs.manifest.json")));
    } catch {
      raw = undefined;
    }
    const checked = checkManifest(raw);
    if (!checked.ok) {
      io.stderr(
        `ogs.manifest.json isn't valid (fix it, or delete it and run ogs init again):\n${issueLines(checked.issues)}`,
      );
      return 1;
    }
    manifest = checked.manifest;
    actions.push({ verb: "keep", path: "ogs.manifest.json", note: "yours: flags don't change it" });
  } else {
    const input = await manifestInput(io, values);
    if (input === 2) return 2;
    const draft = draftManifest(input);
    const checked = checkManifest(draft);
    if (!checked.ok) {
      io.stderr(`ogs.manifest.json wouldn't be valid:\n${issueLines(checked.issues)}`);
      return 2;
    }
    manifest = checked.manifest;
    actions.push({
      verb: "write",
      path: "ogs.manifest.json",
      data: `${JSON.stringify(draft, null, 2)}\n`,
    });
  }

  // 2. The repo, and the kits OGS lists (downloaded now, written at the end).
  const { pm, from } = detectPackageManager(fs, root);
  const framework = detectFramework(fs, root);
  const kits = await fetchKits(io);
  for (const kit of kits.kits)
    actions.push({
      verb: "write",
      path: `vendor/${kit.file}`,
      data: values.dry ? new Uint8Array() : await downloadKit(io, kit),
      note: kit.url,
    });

  const hadPackage = fs.exists(at("package.json"));
  const deps = addDependencies(
    hadPackage ? fs.read(at("package.json")) : null,
    Object.fromEntries(kits.kits.map((k) => [k.name, `file:vendor/${k.file}`])),
    manifest.appId,
  );
  if (!hadPackage)
    actions.push({
      verb: "write",
      path: "package.json",
      data: deps.text,
      note: "new, with the kits",
    });
  else if (deps.added.length > 0)
    actions.push({
      verb: "edit",
      path: "package.json",
      data: deps.text,
      note: `+ ${deps.added.join(", ")}`,
    });
  else actions.push({ verb: "keep", path: "package.json", note: "has the kits" });
  for (const k of deps.kept) notes.push(`${k.name} is already ${k.spec}: left as it is`);

  // 3. The TV and phone entries: patched only with --codemod, on Vite, when exactly one is found.
  const found = findEntries(fs, root);
  const entries: Record<"tv" | "phone", Entry> = {
    tv: { status: "none" },
    phone: { status: "none" },
  };
  const diffs: string[] = [];
  for (const side of ["tv", "phone"] as const) {
    const candidates = found[side];
    const snippet = side === "tv" ? TV_SNIPPET : PHONE_SNIPPET;
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (only) {
      const source = fs.read(at(only));
      const patched = insertAfterImports(source, snippet);
      entries[side] = { status: patched === null ? "hooked" : "found", file: only };
      if (values.codemod && patched === null) notes.push(`${only} already imports profile-kit`);
      if (values.codemod && patched !== null && framework === "vite") {
        entries[side] = { status: "patched", file: only };
        actions.push({ verb: "edit", path: only, data: patched, note: HOOKUP[side] });
        diffs.push(
          `${only}:\n${snippet
            .split("\n")
            .map((l) => `+ ${l}`)
            .join("\n")}`,
        );
        continue;
      }
      if (patched === null) continue;
    } else if (candidates.length > 1) entries[side] = { status: "ambiguous", files: candidates };
    if (values.codemod) {
      const hookup = HOOKUP[side];
      diffs.push(
        `${hookup[0]?.toUpperCase()}${hookup.slice(1)}: ${whereItGoes(side, framework, candidates)}:\n${snippet}`,
      );
    }
  }

  // 4. OGS.md: this repo's checklist.
  const install = installCommand(pm);
  if (fs.exists(at("OGS.md"))) actions.push({ verb: "keep", path: "OGS.md", note: "yours" });
  else
    actions.push({
      verb: "write",
      path: "OGS.md",
      data: renderOgsMd({
        manifest,
        docs: kits.docs,
        llms: kits.llms,
        quickstart: kits.quickstart,
        framework,
        install,
        kits: kits.kits.map((k) => k.name),
        tv: entries.tv,
        phone: entries.phone,
      }),
    });

  // 5. The plan, then (unless --dry) the writes.
  io.stdout(`ogs init: ${manifest.name} (${manifest.appId})`);
  io.stdout(
    `${FRAMEWORK_NAMES[framework]} game, ${pm} (${from === "packageManager" ? "packageManager in package.json" : (from ?? "no lockfile")})`,
  );
  io.stdout("");
  for (const a of actions)
    io.stdout(`  ${a.verb.padEnd(6)} ${a.path}${a.note ? `  (${a.note})` : ""}`);
  for (const n of notes) io.stdout(`  note   ${n}`);
  for (const d of diffs) io.stdout(`\n${d}`);
  io.stdout("");
  if (values.dry) {
    io.stdout("Dry run: nothing changed.");
    return 0;
  }
  for (const a of actions) if (a.verb !== "keep") fs.write(at(a.path), a.data);
  io.stdout(
    `Done. Next: ${install}, then work down OGS.md (its prompt is for your coding agent; ${kits.llms}).`,
  );
  return 0;
}
