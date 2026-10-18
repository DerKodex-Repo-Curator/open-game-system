# Ship your game as its own app

Your OGS game can also be **its own app** on the App Store and Google Play: your name, your icon,
your store listing, published under your own Apple and Google accounts. Inside, it is your phone
page in a WebView with the same native powers the OGS app gives it: casting to the TV, OGS
profiles with native sign-in, push links, haptics and an offline screen.

> **Status:** planned, being built (October 2026): `create-ogs-app`, the `@open-game-system/shell`
> package, the `ogs` CLI and the API behind them. Commands and options here are the v1 design.
> The game keeps working in the OGS app and in a plain browser; nothing on this page changes the
> [game contract](contract.md).

## What you get

| | How |
|---|---|
| **Your game, live from the web** | The app opens your phone page (`gameUrl`). Deploy the web game and every installed app has it, with no store release. |
| **Play on TV** | Chromecast only in v1. A cast button **you** draw with `cast-kit-react`; the app runs the native picker and session. The TV loads the OGS Cast receiver, which shows your manifest's `tvUrl` full screen with no OGS launcher around it, and your TV page still gets `ogs:start` with the couch. |
| **Who is playing** | `useOgsProfile()` (profile-kit), as in the OGS app. Players start as a guest with a real OGS profile; **Sign in with Apple** (Google on Android) is a native sheet in the app, never in your page. One OGS account works in every OGS-powered app. |
| **Push links** | Your server sends with your game's API key, as on [Notifications](notifications.md). OGS delivers to your app with **your** APNs key and FCM service account. A tap opens the page you name. |
| **Links** | `https://<your domain>/…` (with the link files below) and `https://opengame.org/play/<appId>/…` open the app at that page of your game. |
| **Branding** | OGS is invisible by default (`branding: "hidden"`), or shows a small "Powered by OGS" mark (`"powered-by"`). |

What it is not (v1): no in-app purchases or ads, no AirPlay or screen mirroring, one game per app.

## 1. Create the app

In your game's repo (the app lives next to the game, in `app/`):

```bash
pnpm create ogs-app app
```

It asks for your OGS app id, the app's name, the game URL, the iOS bundle id, the Android package,
your Apple Team ID, your link domains and the branding. Agents and CI pass flags instead:

```bash
pnpm create ogs-app app --app-id rocket-crew --name "Rocket Crew" \
  --game-url https://rocketcrew.tv/phone --bundle-id tv.rocketcrew.app \
  --package tv.rocketcrew.app --team-id 34S957HD77 --link-domain rocketcrew.tv --yes
```

With `--yes` it asks nothing: it takes the defaults (the bundle id from your domain, the package
from the bundle id, your game URL's host as the link domain, `hidden` branding) and fails, naming
the flags, on answers that have none. `--no-link-domain` means links go through
`opengame.org/play/<appId>` only. `pnpm create ogs-app --help` lists everything.

You get an Expo app (SDK 55):

```
app.config.ts          name, ids, the shell plugin's settings
app/index.tsx          <OgsShell />: the whole app
app/_layout.tsx        expo-router root
app/+native-intent.ts  every link lands on the one screen; the shell opens it in your game
assets/                a placeholder icon and splash: replace them with your art
eas.json               development, preview (TestFlight / internal testing), production
README.md              run, cast, profiles, push, ship
REVIEW_NOTES.md        your App Review note (guideline 4.2)
link-files/            apple-app-site-association + assetlinks.json for your domain
examples/              the game side: cast button, profile, push link
```

## 2. Configure

Everything is in `app.config.ts`. The ids are yours, and the shell plugin never sets them:

```ts
import type { ShellConfigInput } from "@open-game-system/shell/plugin";
import type { ConfigContext, ExpoConfig } from "expo/config";

const shell = {
  appId: "rocket-crew",                    // your OGS catalogue id
  name: "Rocket Crew",
  gameUrl: "https://rocketcrew.tv/phone",  // the phone page the app opens
  icon: "./assets/icon.png",
  splash: { image: "./assets/splash-icon.png", backgroundColor: "#2a5c8a" },
  branding: "hidden",                      // or "powered-by"
  linkDomains: ["rocketcrew.tv"],          // opengame.org/play/<appId> is always on
  cast: { receiver: "ogs" },
} satisfies ShellConfigInput;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: shell.name,
  slug: shell.appId,
  ios: { bundleIdentifier: "tv.rocketcrew.app", appleTeamId: "34S957HD77", supportsTablet: true },
  android: { package: "tv.rocketcrew.app" },
  plugins: ["expo-router", ["@open-game-system/shell", shell]],
});
```

The plugin adds Google Cast (with the local network permission iOS asks for), push, Sign in with
Apple, the link entitlements and intent filters, and the splash screen, and passes the settings to
`<OgsShell />`. Run it with `pnpm ios` or `pnpm android` (a development build: casting and push are
native, so not Expo Go).

On the game side, copy what you need from `examples/`:

- **Cast button** (`examples/web/cast-button.tsx`): `CastProvider` and `CastButton` from
  `@open-game-system/cast-kit-react`, styled like your game; `useCastViewUrl(url)` names the TV page
  for a room. Show it **only in your own app**: inside the OGS app, OGS casts once for every game
  ([Rules, no cast button](rules.md#1-no-cast-button)).
- **Profile** (`examples/web/player-badge.tsx`): `useOgsProfile()`. Guests and signed-in players look
  the same to your page; key saves on `profile.id`. `null` in a plain browser: ask for a name.
- **Push link** (`examples/server/send-push-link.ts`): `createOgsNotifier` with a `url` on your
  game's origin; the tap opens the app there.

## 3. Register the app with OGS

Install the OGS CLI and log in with your game's API key (the one your server sends pushes with):

```bash
pnpm add -g @open-game-system/cli
ogs login --app rocket-crew
ogs apps register --ios tv.rocketcrew.app --team-id 34S957HD77
ogs apps register --android tv.rocketcrew.app --sha256 AB:CD:… --google-client-id 123-abc.apps.googleusercontent.com
```

Registering lets OGS accept your app's sign-ins (Apple's audience is your bundle id, Google's your
client id) and pushes, and lists your app in opengame.org's link files for `/play/<appId>`. A bundle
id or package belongs to one game. The Android SHA-256 is your signing certificate's: `eas
credentials` shows it after the first Android build.

## 4. Push credentials

Apple only delivers pushes signed with a key from the app's own team, so OGS holds yours:

```bash
ogs push credentials --ios AuthKey_ABC123DEFG.p8 --key-id ABC123DEFG --team-id 34S957HD77
ogs push credentials --android firebase-service-account.json
```

- **iOS:** an APNs key from developer.apple.com → Keys (Apple Push Notifications service).
- **Android:** a Firebase project with an Android app for your package. Put its
  `google-services.json` in the app folder (`app.config.ts` picks it up) and upload a service
  account key for the same project.

OGS stores them encrypted and prints what is configured, never the key. The send call your server
makes does not change.

## 5. Build with EAS

The app builds on your own [EAS](https://expo.dev/eas) account:

```bash
eas init
eas build --profile preview --platform ios    # a store build: TestFlight
eas submit --profile preview --platform ios
eas build --profile preview --platform android
eas submit --profile preview --platform android   # Google Play internal testing
```

| Profile | For |
|---|---|
| `development` | A development build for your own devices (`distribution: internal`) |
| `development-simulator` | The same for the iOS Simulator / an Android emulator |
| `preview` | Store builds for **TestFlight** and Play **internal testing**; build numbers go up by themselves |
| `production` | The release |

Before the first iOS build, the bundle id needs **Push Notifications**, **Sign in with Apple** and
**Associated Domains** on developer.apple.com.

## 6. App Review

An app that mostly shows a website is rejected under guideline 4.2 (Minimum Functionality). Yours
is designed for review: native casting, native push, native sign-in, haptics and a native offline
screen. `REVIEW_NOTES.md` in the app is a note to fill in and paste into App Store Connect → App
Review Information → Notes. It walks the reviewer through each native feature, says how to test
casting without a Chromecast (a short video), gives a demo account or "no account needed", and says
exactly what the WebView loads: your own game's pages, nothing else.

## 7. Link domains

`https://opengame.org/play/<appId>/<path>` opens your app at `<path>` of your game as soon as you
register; OGS serves the link files for it. For your **own domain**, serve the two files from
`link-files/.well-known/` on each domain in `linkDomains`:

| URL | Says |
|---|---|
| `/.well-known/apple-app-site-association` | `appIDs: ["<TEAM>.<bundle id>"]`, every path opens the app |
| `/.well-known/assetlinks.json` | your package and its signing certificate's SHA-256 |

Both must answer `200` with JSON over HTTPS, with no redirect. Then check everything:

```bash
ogs doctor --domain rocketcrew.tv
```

It checks the registration, the push credentials, opengame.org's and your domain's link files, and
that your manifest's `tvUrl` answers, and exits non-zero with what to fix.

## Keeping it up to date

- **The game:** deploy your web game; the app loads it.
- **The shell:** `pnpm up @open-game-system/shell` and a new build. Shell fixes reach you as package
  upgrades.
- **App Store details** (icon, name, permissions): a new build.
