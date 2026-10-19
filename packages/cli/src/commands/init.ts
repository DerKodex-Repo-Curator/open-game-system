import { join } from "node:path";
import { parseArgs } from "node:util";
import { findEntries, insertAfterImports, PHONE_SNIPPET, TV_SNIPPET } from "../init/codemod";
import {
  detectFramework,
  detectPackageManager,
  FRAMEWORK_NAMES,
  type Framework,
  installCommand,
  type PackageManager,
} from "../init/detect";
import { downloadKit, fetchKits, type Kits } from "../init/kits";
import { checkManifest, draftManifest, type Issue, type ManifestInput } from "../init/manifest";
import { type Entry, renderOgsMd } from "../init/ogs-md";
import { addDependencies } from "../init/package-json";
import { type Files, files, type Io } from "../io";

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

type Values = Partial<Record<keyof typeof OPTIONS, string | boolean>>;

type Action =
  | { verb: "write" | "edit"; path: string; data: string | Uint8Array; note?: string }
  | { verb: "keep"; path: string; note?: string };

type InitManifest = { appId: string; name: string; startUrl: string; tvUrl?: string };

/** What ogs init will do: the files (in order), the notes and the snippets it prints. */
type Plan = { actions: Action[]; notes: string[]; diffs: string[] };

const QUESTIONS = [
  ["app-id", "appId (lowercase letters, digits and hyphens, e.g. space-bakery): "],
  ["name", "Game name: "],
  ["start-url", "Start URL (the phone page, https://…): "],
] as const;
const TV_QUESTION = "TV page URL (blank: none, the phone page declares it per room): ";

/** A flag's value, trimmed; undefined when it's absent or blank. */
const str = (values: Values, k: keyof typeof OPTIONS) => {
  const v = values[k];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

const answer = async (prompt: (question: string) => Promise<string>, question: string) =>
  (await prompt(question)).trim() || undefined;

/** At a terminal, asks for each missing field (and the TV page, when no flag gave it). */
async function askMissing(io: Io, got: Record<string, string | undefined>) {
  const missing = QUESTIONS.filter(([k]) => !got[k]);
  if (missing.length === 0 || !io.isTTY || !io.prompt) return;
  for (const [k, q] of missing) got[k] = await answer(io.prompt, q);
  if (!got["tv-url"]) got["tv-url"] = await answer(io.prompt, TV_QUESTION);
}

/** The manifest's fields from the flags, asking for what's missing at a terminal; 2 when it can't. */
async function manifestInput(io: Io, values: Values): Promise<ManifestInput | 2> {
  const got: Record<string, string | undefined> = {
    "app-id": str(values, "app-id"),
    name: str(values, "name"),
    "start-url": str(values, "start-url"),
    "tv-url": str(values, "tv-url"),
  };
  await askMissing(io, got);
  const [appId, name, startUrl] = [got["app-id"], got.name, got["start-url"]];
  if (!appId || !name || !startUrl) {
    const still = QUESTIONS.filter(([k]) => !got[k]).map(([k]) => `--${k}`);
    io.stderr(
      `ogs init: missing ${still.join(", ")}${io.isTTY ? "" : " (no terminal to ask in)"}\n\nUsage: ${INIT_USAGE.join("\n")}`,
    );
    return 2;
  }
  return {
    appId,
    name,
    startUrl,
    tvUrl: got["tv-url"],
    shape: str(values, "shape"),
    tv: str(values, "tv"),
  };
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
  // None or several here: on Vite, the one candidate is patched or already hooked before this.
  if (candidates.length === 0) return `add this at the top of the module that boots your ${page}`;
  return `add this to one of ${candidates.join(", ")}`;
}

/** The repo's ogs.manifest.json (kept as it is), else one from the flags / prompts; an exit code when neither works. */
async function planManifest(
  io: Io,
  fs: Files,
  values: Values,
  plan: Plan,
): Promise<InitManifest | number> {
  const at = join(fs.cwd, "ogs.manifest.json");
  if (fs.exists(at)) {
    const checked = checkManifest(parseOrUndefined(fs.read(at)));
    if (!checked.ok) {
      io.stderr(
        `ogs.manifest.json isn't valid (fix it, or delete it and run ogs init again):\n${issueLines(checked.issues)}`,
      );
      return 1;
    }
    plan.actions.push({
      verb: "keep",
      path: "ogs.manifest.json",
      note: "yours: flags don't change it",
    });
    return checked.manifest;
  }
  const input = await manifestInput(io, values);
  if (input === 2) return 2;
  const draft = draftManifest(input);
  const checked = checkManifest(draft);
  if (!checked.ok) {
    io.stderr(`ogs.manifest.json wouldn't be valid:\n${issueLines(checked.issues)}`);
    return 2;
  }
  plan.actions.push({
    verb: "write",
    path: "ogs.manifest.json",
    data: `${JSON.stringify(draft, null, 2)}\n`,
  });
  return checked.manifest;
}

/** The text's JSON; undefined (which checkManifest refuses) when it isn't JSON. */
function parseOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch /* Stryker disable next-line BlockStatement: equivalent, an empty catch returns undefined too */ {
    return undefined;
  }
}

/** The kit tarballs (downloaded now, written at the end; not downloaded with --dry). */
async function planKits(io: Io, kits: Kits, dry: boolean, plan: Plan) {
  for (const kit of kits.kits)
    plan.actions.push({
      verb: "write",
      path: `vendor/${kit.file}`,
      data: dry ? new Uint8Array() : await downloadKit(io, kit),
      note: kit.url,
    });
}

/** package.json: new with the kits, edited to add them, or kept when it has them. */
function planPackageJson(fs: Files, kits: Kits, appId: string, plan: Plan) {
  const at = join(fs.cwd, "package.json");
  const hadPackage = fs.exists(at);
  const deps = addDependencies(
    hadPackage ? fs.read(at) : null,
    Object.fromEntries(kits.kits.map((k) => [k.name, `file:vendor/${k.file}`])),
    appId,
  );
  if (!hadPackage)
    plan.actions.push({
      verb: "write",
      path: "package.json",
      data: deps.text,
      note: "new, with the kits",
    });
  else if (deps.added.length > 0)
    plan.actions.push({
      verb: "edit",
      path: "package.json",
      data: deps.text,
      note: `+ ${deps.added.join(", ")}`,
    });
  else plan.actions.push({ verb: "keep", path: "package.json", note: "has the kits" });
  for (const k of deps.kept) plan.notes.push(`${k.name} is already ${k.spec}: left as it is`);
}

const plusLines = (snippet: string) =>
  snippet
    .split("\n")
    .map((l) => `+ ${l}`)
    .join("\n");

type Side = "tv" | "phone";
type EntryOptions = { codemod: boolean; framework: Framework };

const SNIPPET = { tv: TV_SNIPPET, phone: PHONE_SNIPPET };

/** The one candidate: hooked already, or patched (--codemod on Vite); null when it stays as found. */
function planOnly(
  fs: Files,
  side: Side,
  only: string,
  opts: EntryOptions,
  plan: Plan,
): Entry | null {
  const patched = insertAfterImports(fs.read(join(fs.cwd, only)), SNIPPET[side]);
  if (patched === null) {
    if (opts.codemod) plan.notes.push(`${only} already imports profile-kit`);
    return { status: "hooked", file: only };
  }
  if (opts.codemod && opts.framework === "vite") {
    plan.actions.push({ verb: "edit", path: only, data: patched, note: HOOKUP[side] });
    plan.diffs.push(`${only}:\n${plusLines(SNIPPET[side])}`);
    return { status: "patched", file: only };
  }
  return null;
}

/** The snippet to place by hand, and where it goes. */
function placeByHand(side: Side, framework: Framework, candidates: string[]) {
  const hookup = HOOKUP[side];
  return `${hookup.charAt(0).toUpperCase()}${hookup.slice(1)}: ${whereItGoes(side, framework, candidates)}:\n${SNIPPET[side]}`;
}

/**
 * One side's entry. With --codemod on Vite, the one candidate that doesn't import profile-kit is
 * patched; otherwise (with --codemod) the snippet is printed with where it goes.
 */
function planEntry(
  fs: Files,
  side: Side,
  candidates: string[],
  opts: EntryOptions,
  plan: Plan,
): Entry {
  const only = candidates.length === 1 ? candidates[0] : undefined;
  if (only) {
    const entry = planOnly(fs, side, only, opts, plan);
    if (entry) return entry;
  }
  if (opts.codemod) plan.diffs.push(placeByHand(side, opts.framework, candidates));
  if (only) return { status: "found", file: only };
  return candidates.length === 0 ? { status: "none" } : { status: "ambiguous", files: candidates };
}

function printPlan(
  io: Io,
  manifest: InitManifest,
  repo: { framework: Framework; pm: PackageManager; from: string | null },
  plan: Plan,
) {
  io.stdout(`ogs init: ${manifest.name} (${manifest.appId})`);
  io.stdout(
    `${FRAMEWORK_NAMES[repo.framework]} game, ${repo.pm} (${repo.from === "packageManager" ? "packageManager in package.json" : (repo.from ?? "no lockfile")})`,
  );
  io.stdout("");
  for (const a of plan.actions)
    io.stdout(`  ${a.verb.padEnd(6)} ${a.path}${a.note ? `  (${a.note})` : ""}`);
  for (const n of plan.notes) io.stdout(`  note   ${n}`);
  for (const d of plan.diffs) io.stdout(`\n${d}`);
  io.stdout("");
}

function parseInitArgs(io: Io, args: string[]): Values | null {
  try {
    return parseArgs({ args, options: OPTIONS }).values;
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n\nUsage: ${INIT_USAGE.join("\n")}`);
    return null;
  }
}

export async function init(io: Io, args: string[]): Promise<number> {
  const values = parseInitArgs(io, args);
  if (values === null) return 2;
  const fs = files(io);
  const plan: Plan = { actions: [], notes: [], diffs: [] };

  // 1. The manifest: the repo's own, or one from the flags / prompts.
  const manifest = await planManifest(io, fs, values, plan);
  if (typeof manifest === "number") return manifest;

  // 2. The repo, and the kits OGS lists (downloaded now, written at the end).
  const { pm, from } = detectPackageManager(fs, fs.cwd);
  const framework = detectFramework(fs, fs.cwd);
  const kits = await fetchKits(io);
  const dry = values.dry === true;
  await planKits(io, kits, dry, plan);
  planPackageJson(fs, kits, manifest.appId, plan);

  // 3. The TV and phone entries: patched only with --codemod, on Vite, when exactly one is found.
  const found = findEntries(fs, fs.cwd);
  const opts = { codemod: values.codemod === true, framework };
  const tv = planEntry(fs, "tv", found.tv, opts, plan);
  const phone = planEntry(fs, "phone", found.phone, opts, plan);

  // 4. OGS.md: this repo's checklist.
  const install = installCommand(pm);
  if (fs.exists(join(fs.cwd, "OGS.md")))
    plan.actions.push({ verb: "keep", path: "OGS.md", note: "yours" });
  else
    plan.actions.push({
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
        tv,
        phone,
      }),
    });

  // 5. The plan, then (unless --dry) the writes.
  printPlan(io, manifest, { framework, pm, from }, plan);
  if (dry) {
    io.stdout("Dry run: nothing changed.");
    return 0;
  }
  for (const a of plan.actions) if (a.verb !== "keep") fs.write(join(fs.cwd, a.path), a.data);
  io.stdout(
    `Done. Next: ${install}, then work down OGS.md (its prompt is for your coding agent; ${kits.llms}).`,
  );
  return 0;
}
