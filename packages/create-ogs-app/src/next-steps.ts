import type { Answers } from "./options";
import { teamIdText } from "./team-id";

const shellQuote = (path: string) => (/^[\w./-]+$/.test(path) ? path : JSON.stringify(path));

/** What to do after the app is generated, as printed by the CLI. */
export function nextSteps(a: Answers, dir: string): string {
  const [domain] = a.linkDomains;
  const links = domain
    ? [
        `Links: serve link-files/.well-known/ at https://${domain}/.well-known/apple-app-site-association`,
        "and /.well-known/assetlinks.json (fill in the SHA-256 from `eas credentials`).",
        `opengame.org/play/${a.appId}/… opens the app too.`,
      ]
    : [`Links: https://opengame.org/play/${a.appId}/… opens the app (add your own domain later).`];
  const team = teamIdText(a.teamId);
  const noTeamYet = a.teamId
    ? []
    : [
        "",
        "The simulator needs no Apple account. A real phone and the stores need your Apple Team ID",
        "(developer.apple.com → Membership): put it in app.config.ts as ios.appleTeamId.",
      ];
  return [
    `Your app is in ${dir}. Next:`,
    "",
    `  cd ${shellQuote(dir)}`,
    "  pnpm install",
    "  pnpm ios                 # or: pnpm android (a development build on a simulator/emulator)",
    ...noTeamYet,
    "",
    "Tell OGS about the app (pnpm add -g @open-game-system/cli):",
    "",
    `  ogs login --app ${a.appId} --key <your game API key, ogsk_…>`,
    `  ogs apps register --ios ${a.bundleId} --team-id ${team}`,
    `  ogs apps register --android ${a.androidPackage} --sha256 <from eas credentials> --google-client-id <id>`,
    `  ogs push credentials --ios AuthKey_<KEYID>.p8 --key-id <KEYID> --team-id ${team}`,
    "  ogs push credentials --android service-account.json",
    "",
    "Build and ship:",
    "",
    "  eas build --profile preview --platform ios      # TestFlight-ready",
    "  eas submit --profile preview --platform ios",
    domain ? `  ogs doctor --domain ${domain}` : "  ogs doctor",
    "",
    ...links,
    "",
    "README.md walks through all of it; REVIEW_NOTES.md is your App Review note.",
  ].join("\n");
}

export const HELP = `Ship your OGS web game as its own iOS and Android app.

Usage:
  pnpm create ogs-app [dir] [flags]
  create-ogs-app [dir] [flags]

Asks for anything not given as a flag. With --yes it asks nothing: it takes the defaults
and fails, naming them, on answers that have none.

Flags:
  --app-id <id>          OGS app id (your game's catalogue id), e.g. rocket-crew
  --name <name>          App name under the icon (≤ 30 characters); default from the app id
  --game-url <url>       The game's phone page (https://) the app opens
  --bundle-id <id>       iOS bundle id; default from the game's domain (tv.rocketcrew.app)
  --package <name>       Android package; default from the bundle id
  --team-id <id>         Apple Team ID (10 characters), or - for none yet: the simulator
                         needs none; a real phone and the stores do
  --link-domain <host>   Your own link domain(s), repeatable or comma-separated;
                         default the game URL's host (not for shared hosts like pages.dev)
  --no-link-domain       No domain of your own: links go through opengame.org/play/<app-id>
  --branding <mode>      hidden (default) or powered-by (a small "Powered by OGS" mark)
  --shell-version <v>    The @open-game-system/shell version to depend on
  -y, --yes              Don't ask; use defaults
  -h, --help             This help

Example:
  pnpm create ogs-app app --app-id rocket-crew --game-url https://rocketcrew.tv/phone \\
    --team-id 34S957HD77 --yes
`;
