import { z } from "zod";
import { COMMANDS } from "./commands";
import { CliError, type Io } from "./io";

export type { Io } from "./io";

/**
 * `ogs`: the OGS developer tool (docs/acceptance/2026-10-18-ogs-cli.feature; docs/design-docs/ogs-cli.md).
 * Everything it touches comes in through `Io`, so tests and the API's seam tests run it without a real
 * network or home directory.
 */
const HELP = () => `ogs: the OGS developer tool

${COMMANDS.flatMap((c) => c.usage.map((u) => `  ${u}`)).join("\n")}

Options: --app <appId> (default: the app you logged in with).
Environment: OGS_API (API base, e.g. a preview), OGS_SITE (link domain to check, default opengame.org),
OGS_CONFIG_DIR (default ~/.config/ogs).`;

/** Runs one command; the exit code: 0 ok, 1 failed, 2 usage. */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    if (!argv[0] || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
      io.stdout(HELP());
      return 0;
    }
    // The longest command whose words start argv (["apps", "register"] before ["apps"]).
    const command = [...COMMANDS]
      .sort((a, b) => b.words.length - a.words.length)
      .find((c) => c.words.every((w, i) => argv[i] === w));
    if (command) return await command.run(io, argv.slice(command.words.length));
    io.stderr(`Unknown command: ${argv.join(" ")}\n\n${HELP()}`);
    return 2;
  } catch (e) {
    if (
      e instanceof CliError ||
      e instanceof TypeError ||
      e instanceof SyntaxError ||
      e instanceof z.ZodError
    ) {
      io.stderr(e instanceof z.ZodError ? "Unexpected answer from the API" : e.message);
      return 1;
    }
    throw e;
  }
}
