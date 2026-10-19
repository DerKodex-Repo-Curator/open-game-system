import { parseArgs } from "node:util";
import { type Manifest, ManifestSchema } from "@open-game-system/ogs-protocol";
import { MAX_PHONES } from "../dev/couch";
import { type DevOptions, type DevServer, lanAddress, startDevServer } from "../dev/server";
import { CliError, type Io } from "../io";

const USAGE =
  "Usage: ogs dev [--manifest ogs.manifest.json] [--start-url <url>] [--tv-url <url>] [--port 4747] [--phones 2] [--lan <ip>]";

/** Until Ctrl-C (or SIGTERM). */
export const untilInterrupted = () =>
  new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });

const isUrl = (v: string) => URL.canParse(v) && /^https?:$/.test(new URL(v).protocol);

function readManifest(io: Io, path: string) {
  let text: string;
  try {
    text = io.readFile(path);
  } catch {
    throw new CliError(`No manifest at ${path}. Run ogs init, or pass --manifest <file>.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CliError(`${path} is not JSON.`);
  }
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success)
    throw new CliError(
      `${path} is not a valid manifest:\n${parsed.error.issues
        .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n")}`,
    );
  return parsed.data;
}

/** --port, --phones and the URLs make sense (the phones take the ports after --port). */
const validOptions = (port: number, phones: number, urls: string[]) =>
  Number.isInteger(port) &&
  port >= 0 &&
  port <= 65535 - MAX_PHONES &&
  Number.isInteger(phones) &&
  phones >= 1 &&
  phones <= MAX_PHONES &&
  urls.every(isUrl);

/** What starts the dev server (tests pass a stand-in). */
type Serve = (opts: DevOptions) => Promise<DevServer>;

/** The dev server; a port in use is said plainly. */
async function start(opts: DevOptions, serve: Serve): Promise<DevServer> {
  try {
    return await serve(opts);
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "EADDRINUSE")
      throw new CliError(
        `Port ${opts.port} (or one of the ${opts.phones} after it, for the phones) is in use. Pass --port <another>.`,
      );
    throw e;
  }
}

/** What ogs dev prints once it serves: the harness, each phone, the LAN, the JWKS URL. */
function banner(manifest: Manifest, server: DevServer, phones: number, tvUrl: string | undefined) {
  return `ogs dev: ${manifest.name} (${manifest.appId})

  Harness   ${server.url}   (TV page + ${phones} phone${phones > 1 ? "s" : ""}: open this)
  TV page   ${tvUrl ?? "none yet: a phone sends it with cast-kit useCastViewUrl"}
${server.phoneUrls.map((u, i) => `  Phone ${i + 1}   ${u}`).join("\n")}
${
  server.lanUrls
    ? `\n  Real phones on this Wi-Fi: scan the QR codes in the harness (${server.lanUrls.harness}).\n  Your game's dev server must listen on the LAN too (vite --host) for ${server.lanUrls.start}.\n`
    : "\n  No LAN address: real phones can't reach this machine.\n"
}
  Game server: verify tokens with OGS_JWKS_URL=${server.jwksUrl}
  Ctrl-C stops.`;
}

/**
 * `ogs dev`: runs the game locally with a fake OGS app and TV (docs/design-docs/ogs-cli.md `ogs dev`).
 * `waitForStop` is how long it serves (tests resolve it themselves).
 */
export async function runDev(
  io: Io,
  args: string[],
  waitForStop: (server: DevServer) => Promise<void> = untilInterrupted,
  serve: Serve = startDevServer,
): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      manifest: { type: "string", default: "ogs.manifest.json" },
      "start-url": { type: "string" },
      "tv-url": { type: "string" },
      port: { type: "string", default: "4747" },
      phones: { type: "string", default: "2" },
      lan: { type: "string" },
    },
  });
  const port = Number(values.port);
  const phones = Number(values.phones);
  const urls = [values["start-url"], values["tv-url"]].filter((u) => u !== undefined);
  if (!validOptions(port, phones, urls)) {
    io.stderr(`${USAGE}\n(--phones is 1 to ${MAX_PHONES}; URLs are http or https)`);
    return 2;
  }
  const manifest = readManifest(io, values.manifest);
  const startUrl = values["start-url"] ?? manifest.startUrl;
  const tvUrl = values["tv-url"] ?? manifest.tvUrl;
  const lan = values.lan ?? lanAddress();
  const server = await start({ manifest, startUrl, tvUrl, port, phones, lan }, serve);
  io.stdout(banner(manifest, server, phones, tvUrl));
  await waitForStop(server);
  await server.close();
  return 0;
}

export const dev = (io: Io, args: string[]) => runDev(io, args);
