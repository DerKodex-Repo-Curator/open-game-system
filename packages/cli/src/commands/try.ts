import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { CliError, call, type Io, session } from "../io";

/**
 * `ogs try`: deploy the game's try-kit try path (its `deploy:try` script, or --command) and register
 * the deployed URL with OGS, which checks its `/` and `/ws-probe` first (PUT /api/v1/apps/:appId/try).
 */
const TryPathSchema = z.object({ appId: z.string(), url: z.string(), checkedAt: z.string() });
const PackageJsonSchema = z.object({ scripts: z.record(z.string(), z.string()).default({}) });

const LOCKFILES: [string, string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** The repo's package manager, from its lockfile (npm when there is none). */
export function packageManager(exists: (file: string) => boolean): string {
  return LOCKFILES.find(([file]) => exists(file))?.[1] ?? "npm";
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal colour codes are what it strips
const ANSI = /\u001b\[[0-9;]*m/g;

/** Where the deploy says it went: the last workers.dev URL it printed, else the last https URL. */
export function deployedUrl(output: string): string | null {
  const urls = output.replace(ANSI, "").match(/https:\/\/[^\s"'<>()]+/g) ?? [];
  const workers = urls.filter((u) => /^https:\/\/[^/]+\.workers\.dev(\/|$)/.test(u));
  return workers.at(-1) ?? urls.at(-1) ?? null;
}

function readOr(io: Io, path: string): string | null {
  try {
    return io.readFile(path);
  } catch {
    return null;
  }
}

/** Runs the deploy and returns the URL it printed (or --url). */
async function deploy(io: Io, cwd: string, command: string | undefined, url: string | undefined) {
  if (!io.exec)
    throw new CliError("This ogs can't run commands; use: ogs try --check-only --url <url>");
  let run = command;
  if (!run) {
    const raw = readOr(io, join(cwd, "package.json"));
    const pkg = PackageJsonSchema.safeParse(raw ? JSON.parse(raw) : {});
    if (!pkg.success || !pkg.data.scripts["deploy:try"])
      throw new CliError(
        `No "deploy:try" script in ${join(cwd, "package.json")}. Add one that deploys your try-kit Worker (e.g. "deploy:try": "wrangler deploy -c wrangler.try.jsonc"), or pass --command "...".`,
      );
    run = `${packageManager((f) => readOr(io, join(cwd, f)) !== null)} run deploy:try`;
  }
  io.stdout(`Deploying: ${run}`);
  const result = await io.exec(run, { cwd });
  if (result.code !== 0) throw new CliError(`${run} failed (exit ${result.code})`);
  const found = url ?? deployedUrl(result.output);
  if (!found)
    throw new CliError(`${run} printed no https URL; pass the deployed URL with --url <https://…>`);
  return found;
}

export async function tryPath(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      app: { type: "string" },
      url: { type: "string" },
      command: { type: "string" },
      "check-only": { type: "boolean", default: false },
    },
  });
  const { appId, key } = session(io, values.app);
  const cwd = io.cwd?.() ?? process.cwd();
  const url = values["check-only"]
    ? (values.url ??
      TryPathSchema.parse(await call(io, "GET", `/api/v1/apps/${appId}/try`, key)).url)
    : await deploy(io, cwd, values.command, values.url);
  io.stdout(`Checking ${url} (GET / and /ws-probe)…`);
  const saved = TryPathSchema.parse(
    await call(io, "PUT", `/api/v1/apps/${appId}/try`, key, { url }),
  );
  io.stdout(
    `ok   try path ${saved.url} registered for ${saved.appId} (checked ${saved.checkedAt})`,
  );
  io.stdout("The catalogue now offers it as the game's tryUrl.");
  return 0;
}
