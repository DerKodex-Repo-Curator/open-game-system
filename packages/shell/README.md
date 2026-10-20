# @open-game-system/shell

The OGS native shell: an OGS web game ships as **its own iOS and Android app** (its name, icon and
store listing) with the native powers the OGS app gives it: casting to the TV, OGS profiles with
native sign-in, push links, haptics and an offline screen. It is two things in one package:

- an **Expo config plugin** that writes the native config (links, Google Cast, push, Sign in with
  Apple, splash, scheme) from a few settings, and
- a **React Native runtime**: `<OgsShell />`, the game's phone page full screen in a WebView bridged
  to the shell's stores.

New apps start from `pnpm create ogs-app` ([create-ogs-app](../create-ogs-app/template/README.md)).
Game developers: [Ship your game as its own app](../../apps/docs/content/ship-your-own-app.md).
Design and decisions: [white-label shell](../../docs/design-docs/white-label-shell.md),
[ADR 2026-10-18-shell-package](../../docs/adrs/2026-10-18-shell-package.md).

## The plugin

```ts
// app.config.ts
plugins: ["expo-router", ["@open-game-system/shell", shell]],
```

`shell` is checked at prebuild (`ShellConfigSchema` in `plugin/src/shell-config.ts`, type
`ShellConfigInput` from `@open-game-system/shell/plugin`); a bad field fails with
`@open-game-system/shell: invalid config. <field>: <problem>`.

| Option | Default | What it does |
|---|---|---|
| `appId` | required | The game's OGS catalogue id (`a-z 0-9 -`). Default scheme, `opengame.org/play/<appId>` links, `OgsShell/<appId>` user agent |
| `gameUrl` | required | The phone page the WebView opens (`https://` only) |
| `name` | required | The app's name; also the iOS local-network prompt ("`<name>` looks for Chromecasts…") and the loading/offline screens |
| `icon` | none | Copied to Expo's top-level `icon` |
| `splash` | none | `{ image, backgroundColor? }` → the `expo-splash-screen` plugin (width 200, `contain`); without it the plugin is added bare |
| `branding` | `"hidden"` | `"powered-by"` shows "Powered by OGS" on the loading and offline screens (never over the game) |
| `linkDomains` | `[]` | Your own bare hosts (`rocketcrew.tv`): iOS `applinks:` and Android `autoVerify` intent filters for `/` |
| `cast` | `{ receiver: "ogs" }` | The only receiver: the OGS Cast app (`807AD5E9`) |
| `scheme` | the `appId` | Expo's `scheme`, set only when the app has none of its own |
| `apiBase` | `DEFAULT_OGS_API` (production) | Point a test build at a preview OGS API |
| `tvBase` | `DEFAULT_TV_BASE` (`https://ogs-tv.pages.dev`) | The OGS TV launcher the Chromecast and browser TVs load |

What it writes (`nativeConfigFor` in `plugin/src/native-config.ts`):

- iOS: `associatedDomains` = `applinks:` for each link domain plus `opengame.org`;
  `usesAppleSignIn: true`; `NSLocalNetworkUsageDescription` and `NSBonjourServices: ["_googlecast._tcp"]`.
- Android: an `autoVerify` VIEW intent filter per link domain, plus `opengame.org` with path prefix
  `/play/<appId>`.
- Plugins: `react-native-google-cast` (receiver `807AD5E9`, discovery from launch),
  `expo-notifications`, `expo-apple-authentication`, `expo-splash-screen`.
- `extra.ogsShell`: `appId`, `gameUrl`, `branding`, `linkDomains` and, when set, `apiBase`/`tvBase`,
  which the runtime reads.

It never sets the bundle id, Android package, Team ID or owner: those stay in the app's own config.
Each part is also a plugin of its own (`withShellLinks`, `withShellCast`, `withShellPush`,
`withShellSignIn`, `withShellScheme`) from `@open-game-system/shell/plugin`.

## The runtime

Two entry points, so importing a module never loads a WebView:

| Import | What |
|---|---|
| `@open-game-system/shell/app` | `OgsShell`, `ShellWebView`, `CastPickerSheet`, `defaultShellDeps` (react-native-webview and the native modules) |
| `@open-game-system/shell` | Every runtime module: stores, API clients, links, push, sign-in, `readRuntimeConfig`, `shellUserAgentName`… |
| `@open-game-system/shell/modules/<name>` | One module (`src/<name>.ts`); `notifications` is only here (it calls `setNotificationHandler` at import) |

The `react-native` export condition gives Metro, jest-expo and tsc the TypeScript source in `src/`;
other consumers get `build/`.

```tsx
// app/index.tsx: the whole app
import { OgsShell } from "@open-game-system/shell/app";
import * as AppleAuthentication from "expo-apple-authentication";

export default function Game() {
  return <OgsShell appleAuthentication={AppleAuthentication} />;
}
```

`OgsShellProps` (all optional): `config` (default: `readRuntimeConfig(Constants.expoConfig)`),
`runtime`, `deps` (overrides of `defaultShellDeps`), `theme` (offline/loading colours),
`appleAuthentication` (the `expo-apple-authentication` module; an optional peer, so the app passes
it in), `linking` (default expo-linking), `pushTaps` (default expo-notifications), `appState`.

What the game's page sees:

- **User agent** ends with `OgsShell/<appId>`: `navigator.userAgent.includes("OgsShell/rocket-crew")`
  means "my own app" (not a browser, not the OGS app).
- **`profile`** store (`useOgsProfile()` in profile-kit): the player starts as a guest; a ready
  profile carries `login`: `guest`, `apple` or `google`.
- **`account`** store: `{ login: "none" | "guest" | "apple" | "google", signingIn }`; the page sends
  `{ type: "SIGN_IN" }` to open the native sign-in sheet.
- **`haptics`** store: `{ type: "IMPACT", style: "light" | "medium" | "heavy" }` and
  `{ type: "NOTIFY", kind: "success" | "warning" | "error" }`.
- **`cast`** (always available, so the game's cast button shows with no Chromecast) and
  `notifications`, as in the OGS app. `SHOW_CAST_PICKER` opens the native TV picker: Chromecasts
  plus "Use a browser TV" (pair by the code `ogs-tv.pages.dev` shows).

testIDs for e2e tools (Maestro, Detox): `ogsShell`, `gameWebView`, `shellLoading`, `poweredByOgs`;
TV picker `castPicker`, `castPickerDevice-<id>`, `castPickerNoDevices`, `castPickerClose`; browser TV
`browserTvOpen`, `browserTv`, `browserTvAddress`, `browserTvCode`, `browserTvPair`,
`browserTvPairing`, `browserTvError`; sign-in `signInSheet`, `signInApple`, `signInGoogle`,
`signInNotNow`, `signInError`, `signInProgress`; offline `gameErrorScreen`, `gameErrorTitle`,
`gameRetryButton`.

### Links

`src/shell-links.ts` maps an incoming link (launch, while running, or a push tap's `data.url`) to
the WebView; anything else is ignored:

- `https://opengame.org/play/<appId>/<rest>` → the game's origin + `/<rest>` (query and hash kept);
- any `https` URL on a link domain, or on the game's own origin → as it is;
- `<scheme>://play/<appId>/<rest>`, `<scheme>://play/<rest>`, `<scheme>://<rest>` → the game's origin
  + `/<rest>` (the dev client's `expo-development-client` links are left alone).

A launch link is the WebView's first page (`launchUrl` from expo-linking), never `gameUrl` first.

### Push

When the game asks, the shell asks the OS, takes the **native** device token
(`getDevicePushTokenAsync`, not an Expo token) and registers it with
`PUT /api/v1/apps/:appId/devices/:deviceId { platform, token, apnsEnvironment }`, again when the
token rotates or the identity changes. `apnsEnvironment` comes from the build's `aps-environment`
entitlement: `development` → `sandbox`; `production` or none (App Store, TestFlight) → `production`.
OGS sends with the developer's own APNs key and FCM account (`ogs push credentials`).

## In apps/mobile

The OGS app is the shell's first consumer (`"@open-game-system/shell": "workspace:*"`):

- Moved modules leave a one-line shim, `apps/mobile/services/<name>.ts` =
  `export * from "@open-game-system/shell/modules/<name>";`, so apps/mobile's suites test them.
- `apps/mobile/services/__tests__/shell-resolution.test.ts` fails when the shell's native peers and
  devDependencies drift from the app's specifiers or resolve to another `.pnpm` copy (a
  `jest.mock` would then miss the shell's import). `bridge-resolution.test.ts` does the same for
  app-bridge-react-native's `react`, `react-native` and `react-native-webview`. A new native module
  goes into apps/mobile first, with the same specifier.
- The shell is JS only, so apps/mobile's native fingerprint does not change: shell changes ship
  over the OTA channel (`mobile-release.yml` and `ci-mobile.yml` watch `packages/shell/**`).

## Tests

Plugin core and the packed-tarball checks (Vitest, builds `plugin/build` first):

```bash
pnpm --filter @open-game-system/shell test:plugin
```

Runtime (jest-expo, `src/__tests__`):

```bash
pnpm --filter @open-game-system/shell test:runtime
```

Mutation testing of `src/` (Stryker, in place, with apps/mobile's suites; don't commit during a run):

```bash
pnpm --filter @open-game-system/shell test:mutate
```

`examples/shell-single-game` checks the plugin's output through `expo config --type introspect`;
`packages/create-ogs-app/scripts/e2e-simulator.sh` publishes the shell to a throwaway registry,
builds a generated app and opens it in a simulator ([docs/testing/e2e.md](../../docs/testing/e2e.md)).

## Packing it for an app

Until it is on npm, an app installs the shell and its workspace packages as tarballs. Build them:

```bash
pnpm --filter "@open-game-system/shell..." run build
```

Pack them into the app's `vendor/`; it prints the `dependencies` and `pnpm.overrides` entries to put
in the app's `package.json`:

```bash
node packages/shell/scripts/pack-vendor.mjs ~/src/rocket-crew-app/app/vendor
```

A re-pack keeps the same file names, so in the app remove the old copies before installing:

```bash
rm -rf node_modules/@open-game-system
```

```bash
pnpm install
```
