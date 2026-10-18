import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

/**
 * `ogs`: set up a game's white-label app with OGS (docs/acceptance/2026-10-18-ogs-cli.feature;
 * ADR 2026-10-18-multi-tenant-push). Everything it touches comes in through `Io`, so tests and the
 * API's seam test run it without a real network or home directory.
 */
export type Io = {
  env: Record<string, string | undefined>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readFile: (path: string) => string;
  fetch: typeof fetch;
};

const DEFAULT_API = "https://opengame-api.jonathanrmumm.workers.dev";
const DEFAULT_SITE = "https://opengame.org";

const HELP = `ogs: set up your game's own app with OGS

  ogs login --app <appId> --key <game API key>
  ogs apps register --ios <bundle id> --team-id <Apple team id>
  ogs apps register --android <package> --sha256 <fingerprint,...> [--google-client-id <id,...>]
  ogs push credentials --ios <AuthKey.p8> --key-id <key id> --team-id <Apple team id>
  ogs push credentials --android <service-account.json>
  ogs doctor [--domain <your link domain>]

Options: --app <appId> (default: the app you logged in with).
Environment: OGS_API (API base, e.g. a preview), OGS_SITE (link domain to check, default opengame.org),
OGS_CONFIG_DIR (default ~/.config/ogs).`;

const CredentialsFileSchema = z.object({
  currentApp: z.string().optional(),
  apps: z.record(z.string(), z.object({ key: z.string() })).default({}),
});
type CredentialsFile = z.infer<typeof CredentialsFileSchema>;

const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string().optional() }) });

class CliError extends Error {}

function configDir(io: Io) {
  return io.env.OGS_CONFIG_DIR ?? join(io.env.HOME ?? homedir(), ".config", "ogs");
}

function readCredentials(io: Io): CredentialsFile {
  try {
    return CredentialsFileSchema.parse(JSON.parse(readFileSync(join(configDir(io), "credentials.json"), "utf8")));
  } catch {
    return { apps: {} };
  }
}

function saveCredentials(io: Io, file: CredentialsFile) {
  const dir = configDir(io);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "credentials.json");
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const api = (io: Io) => (io.env.OGS_API ?? DEFAULT_API).replace(/\/+$/, "");

/** The API's answer as JSON; throws a CliError with the API's error code on failure. */
async function call(io: Io, method: string, path: string, key: string, body?: unknown): Promise<unknown> {
  const res = await io.fetch(`${api(io)}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(text ? JSON.parse(text) : {});
    throw new CliError(parsed.success ? `${parsed.data.error.code}: ${parsed.data.error.message ?? ""}`.trim() : `HTTP ${res.status}`);
  }
  return text ? JSON.parse(text) : null;
}

/** The app and its key: --app, else the one logged in last. */
function session(io: Io, app: string | undefined): { appId: string; key: string } {
  const creds = readCredentials(io);
  const appId = app ?? creds.currentApp;
  const key = appId ? creds.apps[appId]?.key : undefined;
  if (!appId || !key) throw new CliError(`Not logged in${appId ? ` for ${appId}` : ""}. Run: ogs login --app <appId> --key <game API key>`);
  return { appId, key };
}

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function login(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { app: { type: "string" }, key: { type: "string" } } });
  if (!values.app || !values.key) {
    io.stderr("Usage: ogs login --app <appId> --key <game API key>");
    return 2;
  }
  await call(io, "GET", `/api/v1/apps/${values.app}/native`, values.key);
  const creds = readCredentials(io);
  saveCredentials(io, { currentApp: values.app, apps: { ...creds.apps, [values.app]: { key: values.key } } });
  io.stdout(`Logged in for ${values.app}. The key is saved in ${join(configDir(io), "credentials.json")}.`);
  return 0;
}

async function register(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { app: { type: "string" }, ios: { type: "string" }, android: { type: "string" }, "team-id": { type: "string" }, sha256: { type: "string" }, "google-client-id": { type: "string" } },
  });
  const { appId, key } = session(io, values.app);
  if (values.ios && values["team-id"]) {
    await call(io, "PUT", `/api/v1/apps/${appId}/native/ios`, key, { bundleId: values.ios, teamId: values["team-id"] });
    io.stdout(`Registered ios app ${values.ios} for ${appId}.`);
    return 0;
  }
  if (values.android && values.sha256) {
    await call(io, "PUT", `/api/v1/apps/${appId}/native/android`, key, {
      package: values.android,
      sha256CertFingerprints: list(values.sha256),
      googleClientIds: list(values["google-client-id"]),
    });
    io.stdout(`Registered android app ${values.android} for ${appId}.`);
    return 0;
  }
  io.stderr("Usage: ogs apps register --ios <bundle id> --team-id <team id> | --android <package> --sha256 <fingerprint,...>");
  return 2;
}

const SummarySchema = z.object({
  ios: z.object({ configured: z.boolean(), keyId: z.string().nullish(), teamId: z.string().nullish(), bundleId: z.string().nullish() }),
  android: z.object({ configured: z.boolean(), projectId: z.string().nullish(), clientEmail: z.string().nullish(), package: z.string().nullish() }),
});

async function credentials(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { app: { type: "string" }, ios: { type: "string" }, android: { type: "string" }, "key-id": { type: "string" }, "team-id": { type: "string" } },
  });
  const { appId, key } = session(io, values.app);
  if (values.ios && values["key-id"] && values["team-id"])
    await call(io, "PUT", `/api/v1/apps/${appId}/push-credentials`, key, { ios: { p8: io.readFile(values.ios), keyId: values["key-id"], teamId: values["team-id"] } });
  else if (values.android) await call(io, "PUT", `/api/v1/apps/${appId}/push-credentials`, key, { android: { serviceAccount: JSON.parse(io.readFile(values.android)) } });
  else {
    io.stderr("Usage: ogs push credentials --ios <AuthKey.p8> --key-id <id> --team-id <id> | --android <service-account.json>");
    return 2;
  }
  const s = SummarySchema.parse(await call(io, "GET", `/api/v1/apps/${appId}/push-credentials`, key));
  io.stdout(s.ios.configured ? `ios: configured (key ${s.ios.keyId}, team ${s.ios.teamId}, ${s.ios.bundleId})` : "ios: not configured");
  io.stdout(s.android.configured ? `android: configured (project ${s.android.projectId}, ${s.android.clientEmail}, ${s.android.package})` : "android: not configured");
  return 0;
}

const NativeListSchema = z.object({
  apps: z.array(
    z.discriminatedUnion("platform", [
      z.object({ platform: z.literal("ios"), bundleId: z.string(), teamId: z.string() }),
      z.object({ platform: z.literal("android"), package: z.string(), sha256CertFingerprints: z.array(z.string()) }),
    ]),
  ),
});
const AasaSchema = z.object({ applinks: z.object({ details: z.array(z.object({ appID: z.string(), paths: z.array(z.string()) })) }) });
const AssetlinksSchema = z.array(z.object({ target: z.object({ package_name: z.string().optional() }) }));
const CatalogueSchema = z.array(z.looseObject({ appId: z.string(), tvUrl: z.string().optional() }));

async function getJson(io: Io, url: string): Promise<unknown> {
  const res = await io.fetch(url);
  if (!res.ok) throw new CliError(`HTTP ${res.status}`);
  return res.json();
}

async function doctor(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { app: { type: "string" }, domain: { type: "string" } } });
  const { appId, key } = session(io, values.app);
  let failed = false;
  const ok = (line: string) => io.stdout(`ok   ${line}`);
  const fail = (line: string) => {
    failed = true;
    io.stdout(`FAIL ${line}`);
  };
  const note = (line: string) => io.stdout(`--   ${line}`);

  const apps = NativeListSchema.parse(await call(io, "GET", `/api/v1/apps/${appId}/native`, key)).apps;
  const ios = apps.find((a) => a.platform === "ios");
  const android = apps.find((a) => a.platform === "android");
  if (!ios && !android) fail(`no app registered for ${appId}. Run: ogs apps register --ios <bundle id> --team-id <team id>`);
  if (ios?.platform === "ios") ok(`ios app registered: ${ios.bundleId} (team ${ios.teamId})`);
  if (android?.platform === "android") ok(`android app registered: ${android.package}`);

  const creds = SummarySchema.parse(await call(io, "GET", `/api/v1/apps/${appId}/push-credentials`, key));
  if (ios?.platform === "ios")
    creds.ios.configured
      ? ok(`ios push credentials: key ${creds.ios.keyId}`)
      : fail(`ios push credentials: none uploaded. Run: ogs push credentials --ios AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --team-id ${ios.teamId}`);
  if (android?.platform === "android")
    creds.android.configured
      ? ok(`android push credentials: project ${creds.android.projectId}`)
      : fail("android push credentials: none uploaded. Run: ogs push credentials --android service-account.json");

  const domains = [io.env.OGS_SITE ?? DEFAULT_SITE, ...(values.domain ? [`https://${values.domain.replace(/^https?:\/\//, "")}`] : [])];
  for (const site of domains) {
    const host = new URL(site).host;
    const own = site !== (io.env.OGS_SITE ?? DEFAULT_SITE);
    if (ios?.platform === "ios") {
      const appleAppId = `${ios.teamId}.${ios.bundleId}`;
      try {
        const aasa = AasaSchema.parse(await getJson(io, `${site}/.well-known/apple-app-site-association`));
        const listed = aasa.applinks.details.some((d) => d.appID === appleAppId && (own || d.paths.includes(`/play/${appId}/*`)));
        listed
          ? ok(`${host} apple-app-site-association lists ${appleAppId}${own ? "" : ` for /play/${appId}/*`}`)
          : fail(`${host} apple-app-site-association doesn't list ${appleAppId}${own ? " (add it to your domain's file)" : " yet (it updates within 5 minutes of registering)"}`);
      } catch (e) {
        fail(`${host} apple-app-site-association: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (android?.platform === "android") {
      try {
        const links = AssetlinksSchema.parse(await getJson(io, `${site}/.well-known/assetlinks.json`));
        links.some((l) => l.target.package_name === android.package)
          ? ok(`${host} assetlinks.json lists ${android.package}`)
          : fail(`${host} assetlinks.json doesn't list ${android.package}`);
      } catch (e) {
        fail(`${host} assetlinks.json: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  try {
    const game = CatalogueSchema.parse(await getJson(io, `${api(io)}/api/v1/catalogue`)).find((g) => g.appId === appId);
    if (!game) note(`${appId} isn't in the OGS catalogue (casting uses the TV page your phone page declares)`);
    else if (!game.tvUrl) note("no tvUrl in the manifest (the TV shows the page your phone page declares)");
    else {
      const res = await io.fetch(game.tvUrl);
      res.ok ? ok(`tvUrl answers: ${game.tvUrl}`) : fail(`tvUrl ${game.tvUrl} answered HTTP ${res.status}`);
    }
  } catch (e) {
    fail(`catalogue: ${e instanceof Error ? e.message : String(e)}`);
  }
  return failed ? 1 : 0;
}

/** Runs one command; the exit code: 0 ok, 1 failed, 2 usage. */
export async function run(argv: string[], io: Io): Promise<number> {
  const [a, b, ...rest] = argv;
  try {
    if (!a || a === "--help" || a === "-h" || a === "help") {
      io.stdout(HELP);
      return 0;
    }
    if (a === "login") return await login(io, [b, ...rest].filter((x): x is string => x !== undefined));
    if (a === "apps" && b === "register") return await register(io, rest);
    if (a === "push" && b === "credentials") return await credentials(io, rest);
    if (a === "doctor") return await doctor(io, [b, ...rest].filter((x): x is string => x !== undefined));
    io.stderr(`Unknown command: ${argv.join(" ")}\n\n${HELP}`);
    return 2;
  } catch (e) {
    if (e instanceof CliError || e instanceof TypeError || e instanceof SyntaxError || e instanceof z.ZodError) {
      io.stderr(e instanceof z.ZodError ? "Unexpected answer from the API" : e.message);
      return 1;
    }
    throw e;
  }
}
