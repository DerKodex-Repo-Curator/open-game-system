import type { Io } from "../io";
import { register } from "./apps";
import { doctor } from "./doctor";
import { INIT_USAGE, init } from "./init";
import { login } from "./login";
import { credentials } from "./push";

/**
 * Every ogs command: its words (["apps", "register"]), its usage lines for --help, and what it runs.
 * A new command is one file in this folder plus one entry here.
 */
export type Command = {
  words: string[];
  usage: string[];
  run: (io: Io, args: string[]) => Promise<number>;
};

export const COMMANDS: Command[] = [
  { words: ["login"], usage: ["ogs login --app <appId> --key <game API key>"], run: login },
  {
    words: ["apps", "register"],
    usage: [
      "ogs apps register --ios <bundle id> --team-id <Apple team id>",
      "ogs apps register --android <package> --sha256 <fingerprint,...> [--google-client-id <id,...>]",
    ],
    run: register,
  },
  {
    words: ["push", "credentials"],
    usage: [
      "ogs push credentials --ios <AuthKey.p8> --key-id <key id> --team-id <Apple team id>",
      "ogs push credentials --android <service-account.json>",
    ],
    run: credentials,
  },
  { words: ["doctor"], usage: ["ogs doctor [--domain <your link domain>]"], run: doctor },
  { words: ["init"], usage: INIT_USAGE, run: init },
];
