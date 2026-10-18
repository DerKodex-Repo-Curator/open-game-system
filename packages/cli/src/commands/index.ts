import type { Io } from "../io";
import { register } from "./apps";
import { dev } from "./dev";
import { doctor } from "./doctor";
import { login } from "./login";
import { credentials } from "./push";
import { PUSH_SEND_USAGE, send } from "./push-send";
import { tryPath } from "./try";

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
  {
    words: ["try"],
    usage: ['ogs try [--command "..."] [--url <deployed https URL>] [--check-only]'],
    run: tryPath,
  },
  { words: ["push", "send"], usage: [PUSH_SEND_USAGE], run: send },
  {
    words: ["dev"],
    usage: [
      "ogs dev [--manifest <file>] [--start-url <url>] [--tv-url <url>] [--port 4747] [--phones 2] [--lan <ip>]",
    ],
    run: dev,
  },
];
