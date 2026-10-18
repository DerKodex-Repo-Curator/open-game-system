import { FRAMEWORK_NAMES, type Framework } from "./detect";

/**
 * OGS.md: the docs' quickstart (apps/docs/content/quickstart.md) as a checklist for one repo, with
 * the agent prompt and the llms.txt link. ogs-md.test.ts keeps the prompt and the steps in step with
 * the page.
 */
export type Entry =
  | { status: "patched" | "found" | "hooked"; file: string }
  | { status: "ambiguous"; files: string[] }
  | { status: "none" };

export type OgsMdInput = {
  manifest: { appId: string; name: string; startUrl: string; tvUrl?: string };
  docs: string;
  llms: string;
  quickstart: string;
  framework: Framework;
  install: string;
  kits: string[];
  tv: Entry;
  phone: Entry;
};

const prompt = (
  docs: string,
) => `Make this web game OGS-compatible. Follow the step-by-step checklist at
${docs}/quickstart.md and treat ${docs}/contract.md as the
contract (if the two disagree, the contract wins). APIs: ${docs}/profile-kit.md and
${docs}/messages.md. Everything in one file: ${docs}/llms-full.txt

Rules: the game never casts and shows no cast button; on an OGS TV it shows no room code, join QR or
"join at" URL; nothing covers the TV's focal area; the TV page goes silent on ogs:suspend; the game
still works in a plain browser. Work test-first: write the seam tests from
${docs}/testing.md before the code they cover. Tell me which steps are done,
which tests prove each one, and anything you could not verify.
`;

const where = (entry: Entry, page: string) => {
  switch (entry.status) {
    case "patched":
      return `\`${entry.file}\` (ogs init --codemod added the hookup)`;
    case "hooked":
      return `\`${entry.file}\` (already imports profile-kit)`;
    case "found":
      return `\`${entry.file}\``;
    case "ambiguous":
      return `one of ${entry.files.map((f) => `\`${f}\``).join(", ")}`;
    case "none":
      return `not found (the module that boots your ${page} page)`;
  }
};

const inFile = (entry: Entry) =>
  entry.status === "patched" || entry.status === "found" || entry.status === "hooked"
    ? ` In \`${entry.file}\`.`
    : "";

const FRAMEWORK_NOTE: Record<Framework, string> = {
  vite: "",
  plain:
    "\n**Plain HTML:** the kits are npm packages, so a page without a bundler can't import them as is. Add a bundler (Vite takes your HTML as it is) or map `@open-game-system/profile-kit` in an import map to a built copy.\n",
  next: '\n**Next.js:** profile-kit reads `window` and listens for messages: call it only in client code (a `"use client"` component, inside `useEffect`), never during server rendering.\n',
  "tanstack-start":
    "\n**TanStack Start:** profile-kit reads `window` and listens for messages: call it only on the client (inside `useEffect`, or a client-only component), never during server rendering.\n",
};

export function renderOgsMd(i: OgsMdInput): string {
  const { appId, name, startUrl, tvUrl } = i.manifest;
  const step = (title: string, body: string) => `- [ ] **${title}** ${body}`;
  return `# OGS for ${name}

\`ogs init\` started adding OGS to this ${FRAMEWORK_NAMES[i.framework]} game. This is the
[OGS quickstart](${i.quickstart}) as a checklist for this repo: work down it test-first and commit
after each green step. Everything in one file, for agents: ${i.llms}

- appId: \`${appId}\` (the catalogue, the art folder and the \`aud\` of your game tokens)
- Manifest: \`ogs.manifest.json\` (start URL ${startUrl}${tvUrl ? `, TV page ${tvUrl}` : ", no static TV page"})
- Kits in \`vendor/\`: ${i.kits.map((k) => `\`${k}\``).join(", ")}
- TV entry: ${where(i.tv, "TV")}
- Phone entry: ${where(i.phone, "phone")}
${FRAMEWORK_NOTE[i.framework]}
## Prompt for your agent

Copy this into your agent, in this repository:

\`\`\`text
${prompt(i.docs)}\`\`\`

## The checklist

Details for every step: ${i.quickstart}

${[
  step(
    "1. Install profile-kit",
    `\`ogs init\` put the kits in \`vendor/\` and added them to package.json as \`file:vendor/…\`. Run \`${i.install}\` (after a newer kit under the same file name, \`${i.install} --force\`). Done when \`import { onOgsPause } from "@open-game-system/profile-kit"\` type-checks.`,
  ),
  step(
    "2. Make the TV page frameable",
    `No \`X-Frame-Options\` or \`frame-ancestors\` that blocks the launcher, start without a tap, no full-screen button when framed. Done when \`<iframe src="${tvUrl ?? "YOUR_TV_URL"}">\` shows it playing.`,
  ),
  step(
    "3. TV page: hear the launcher",
    `\`getOgsSessionSource()\` at module load of the TV entry; \`onOgsPause\` silences every \`AudioContext\`, \`<audio>\` and \`<video>\` on \`ogs:suspend\` and resumes only what played.${inFile(i.tv)}`,
  ),
  step(
    "4. TV page: no join UI inside OGS",
    'With a session, hide the room code, join QR, "join at" URL and cast button; with `null` (a plain browser) keep them.',
  ),
  step(
    "5. Phone page: use the OGS profile",
    `\`useOgsProfile()\` / \`getOgsProfileSource()\`: in the OGS app join once under the OGS name and avatar, no name form; in a plain browser the form stays.${inFile(i.phone)}`,
  ),
  step(
    "6. Server: verify game tokens",
    `\`verifyOgsToken(token, { appId: "${appId}", jwksUrl: env.OGS_JWKS_URL })\` before a seat, a score or a name counts.`,
  ),
  step(
    "7. Report the sitting's label",
    `\`reportOgsSitting({ instanceId, appId: "${appId}", status, title })\` whenever the label changes.`,
  ),
  step(
    "8. Room games: declare the TV page from the phone",
    tvUrl
      ? "Skip this: the manifest has a static `tvUrl`."
      : "The host's phone page calls cast-kit's `useCastViewUrl(tvUrl)` inside OGS (cast-kit is in `vendor/`). No `<CastButton>`.",
  ),
  step(
    "9. Rooms: the couch's phones, and other homes",
    "`reportOgsRoom(room)` from the TV page; phones join `ogsRoomFromUrl(location.href)` when it isn't `null`. Several homes: `multiCouch: true` in the manifest.",
  ),
  step(
    "10. Art kit and manifest",
    `\`ogs.manifest.json\` names the art kit at \`/art/${appId}/…\`: make the four images (icon, cover, logo, heroClean) and \`tv.jpg\`, and add \`roles\` (one a kid can play, unless it's for grown-ups).`,
  ),
  step(
    "11. Test it",
    "The seam tests from the docs' Testing page: the TV page in a stand-in launcher, the phone page in a fake WebView, no full-screen button when framed, the plain-browser check.",
  ),
  step(
    "12. Submit to the catalogue",
    "A pull request to the OGS repository with your manifest and art kit (the docs' Art kit and catalogue page).",
  ),
  step(
    "13. Tell players when it's their turn (optional)",
    "Only for games where a player waits on someone who isn't looking: `requestOgsNotifications()` from a tap, then `createOgsNotifier` on your server.",
  ),
].join("\n")}
`;
}
