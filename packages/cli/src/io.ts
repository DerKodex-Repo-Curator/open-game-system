import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/**
 * What every ogs command shares: the outside world (Io), the saved login, and the API client. Commands
 * live in src/commands/*, one file each, registered in src/commands/index.ts.
 */
export type Io = {
  env: Record<string, string | undefined>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readFile: (path: string) => string;
  fetch: typeof fetch;
  /** The directory commands work in (the game's repo); default process.cwd(). */
  cwd?: string;
  /**
   * Runs a shell command in `cwd`, its output shown to the user as it runs; resolves with its exit
   * code and everything it printed (`ogs try` reads the deployed URL from it). Absent: no processes.
   */
  exec?: (command: string, opts: { cwd: string }) => Promise<{ code: number; output: string }>;
};

const DEFAULT_API = "https://opengame-api.jonathanrmumm.workers.dev";
export const DEFAULT_SITE = "https://opengame.org";

const CredentialsFileSchema = z.object({
  currentApp: z.string().optional(),
  apps: z.record(z.string(), z.object({ key: z.string() })).default({}),
});
type CredentialsFile = z.infer<typeof CredentialsFileSchema>;

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

export class CliError extends Error {}

export function configDir(io: Io) {
  return io.env.OGS_CONFIG_DIR ?? join(io.env.HOME ?? homedir(), ".config", "ogs");
}

export function readCredentials(io: Io): CredentialsFile {
  try {
    return CredentialsFileSchema.parse(
      JSON.parse(readFileSync(join(configDir(io), "credentials.json"), "utf8")),
    );
  } catch {
    return { apps: {} };
  }
}

export function saveCredentials(io: Io, file: CredentialsFile) {
  const dir = configDir(io);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "credentials.json");
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export const api = (io: Io) => (io.env.OGS_API ?? DEFAULT_API).replace(/\/+$/, "");

/** The API's answer as JSON; throws a CliError with the API's error code on failure. */
export async function call(
  io: Io,
  method: string,
  path: string,
  key: string,
  body?: unknown,
): Promise<unknown> {
  const res = await io.fetch(`${api(io)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(text ? JSON.parse(text) : {});
    throw new CliError(
      parsed.success
        ? `${parsed.data.error.code}: ${parsed.data.error.message ?? ""}`.trim()
        : `HTTP ${res.status}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

/** The app and its key: --app, else the one logged in last. */
export function session(io: Io, app: string | undefined): { appId: string; key: string } {
  const creds = readCredentials(io);
  const appId = app ?? creds.currentApp;
  const key = appId ? creds.apps[appId]?.key : undefined;
  if (!appId || !key)
    throw new CliError(
      `Not logged in${appId ? ` for ${appId}` : ""}. Run: ogs login --app <appId> --key <game API key>`,
    );
  return { appId, key };
}

export const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export async function getJson(io: Io, url: string): Promise<unknown> {
  const res = await io.fetch(url);
  if (!res.ok) throw new CliError(`HTTP ${res.status}`);
  return res.json();
}
