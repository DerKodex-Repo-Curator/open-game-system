# __OGS_APP_NAME__ for iOS and Android

This is **__OGS_APP_NAME__** as its own app, under your name, icon and store listing. It opens your
game's phone page (`__OGS_GAME_URL__`) and gives it the native powers of the OGS app through
[`@open-game-system/shell`](https://ogs-docs.pages.dev/ship-your-own-app):

| Your page gets | How |
|---|---|
| **Play on TV** (Chromecast) | Your own button with `cast-kit-react`; the app runs the native picker and session. The TV shows your manifest's `tvUrl` full screen. |
| **Who is playing** | `useOgsProfile()` from `profile-kit`: a guest profile from the first launch, then **Sign in with Apple / Google** in a native sheet. One OGS account works in every OGS-powered app. |
| **Push links** | Your server sends one call; OGS delivers it to this app with your own APNs key / FCM account. A tap opens the page you name. |
| **Links** | `__OGS_LINK_BASE__/…` and `opengame.org/play/__OGS_APP_ID__/…` open the app at that page. |
| **Haptics, offline screen** | Native, from the shell. |

The game itself stays on the web: deploy it and the app has the new version, no store release.
You only rebuild the app for a new icon, name, native permission or shell upgrade.

```
app.config.ts          name, ids, the shell plugin's settings
app/index.tsx          <OgsShell />: the whole app
app/_layout.tsx        expo-router root (no header)
app/+native-intent.ts  every link lands on the one screen; the shell routes it into the game
assets/                placeholder icon and splash: replace them with your art
eas.json               development, preview (TestFlight / internal testing), production
REVIEW_NOTES.md        your App Review note (guideline 4.2)
link-files/            AASA + assetlinks.json for your own domain (only with a link domain)
examples/              the game side: cast button, profile, push link (copy into your web game)
```

## Run it

You need Node 20+, pnpm, Xcode (iOS) or Android Studio (Android). Casting and push need a
development build (they are native), not Expo Go.

```bash
pnpm install
pnpm ios        # builds and opens the app in the iOS Simulator
pnpm android    # same on an Android emulator
pnpm start      # later: just the JS server for an installed development build
```

The app opens `__OGS_GAME_URL__`. To point it at your local game while developing, change
`gameUrl` in `app.config.ts` to a URL the simulator can reach (an https tunnel, for example
`cloudflared tunnel --url http://localhost:5173`), then `pnpm ios` again.

What works where:

| | Simulator / emulator | Real phone |
|---|---|---|
| The game, profile, sign-in sheet, offline screen | yes | yes |
| Casting | no Chromecast discovery in the iOS Simulator; the Android emulator can see TVs on its network | yes |
| Push | iOS Simulator: no remote pushes from APNs; Android emulator with Google Play: yes | yes |

For a real phone without TestFlight: `eas build --profile development --platform ios` and
install it from the link (register the phone first with `eas device:create`).

## Cast to the TV

Casting is **your** button on **your** phone page, styled like your game:
[`examples/web/cast-button.tsx`](examples/web/cast-button.tsx). The shell answers it with the
native Chromecast picker and session; the TV loads the OGS Cast receiver, which shows your
manifest's `tvUrl` full screen with nothing around it, and your TV page gets the couch through
`ogs:start` as it does in the OGS launcher. A room game names the TV page for its room with
`useCastViewUrl(url)`.

Inside the OGS app the same page shows no cast button (OGS casts once for every game): the
example checks `inOwnApp()`.

## Profiles and sign-in

Your page reads the player with `useOgsProfile()` ([`examples/web/player-badge.tsx`](examples/web/player-badge.tsx)):

- `undefined` for a moment while the app answers, then a profile `{ id, handle, name, avatar, token }`.
- From the first launch the player is a **guest** with a real OGS profile, so your game works at
  once. Signing in with Apple (or Google on Android) happens in the app's native sheet, never in
  your page; it keeps the guest's profile, or switches to the player's existing OGS profile.
  Key your saves on `profile.id`.
- `null` in a plain browser: ask for a name as you do today.
- Your server checks `profile.token` with `verifyOgsToken` (`profile-kit/server`).

Sign in with Apple needs the capability on your bundle id (below). Google sign-in on Android
needs an OAuth client id for `__OGS_ANDROID_PACKAGE__`, registered with `ogs apps register --google-client-id`.

## Push links

1. Your page asks from a tap: `requestOgsNotifications()` (profile-kit) shows the app's native
   prompt and gives you a **push handle**. Keep it on the player's seat on your server.
2. Your server sends with your game's OGS API key:
   [`examples/server/send-push-link.ts`](examples/server/send-push-link.ts). `url` is a page on
   `__OGS_GAME_ORIGIN__`; a tap opens the app there.
3. OGS sends it to this app with **your** APNs key and FCM service account (step 3 below).

Android push needs a Firebase project: add an Android app for `__OGS_ANDROID_PACKAGE__` in the
Firebase console, download `google-services.json` into this folder (it is not a secret;
`app.config.ts` picks it up), and create a service account key for `ogs push credentials`.

## Ship it

Each step once per app, in this order.

### 1. Apple and Google accounts

- [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list): register the
  bundle id `__OGS_BUNDLE_ID__` (team `__OGS_APPLE_TEAM_ID__`) with **Push Notifications**, **Sign in with
  Apple** and **Associated Domains**. (`eas build` can create it; check the three capabilities.)
- Create an APNs key (Keys → +, Apple Push Notifications service). Download `AuthKey_<KEYID>.p8`
  once and keep it out of git (`.gitignore` already ignores `*.p8` and `secrets/`).
- Google Play Console (when you ship Android): create the app for `__OGS_ANDROID_PACKAGE__`.

### 2. Tell OGS about the app

Install the OGS CLI (`pnpm add -g @open-game-system/cli`). Log in with your game's OGS API key,
the one your server uses to send pushes:

```bash
ogs login --app __OGS_APP_ID__ --key ogsk_…   # your game API key; OGS_API=<url> points at a preview
ogs apps register --ios __OGS_BUNDLE_ID__ --team-id __OGS_APPLE_TEAM_ID__
ogs apps register --android __OGS_ANDROID_PACKAGE__ --sha256 <SHA-256 from eas credentials> --google-client-id <id>.apps.googleusercontent.com
```

Registering lets OGS accept this app's sign-ins and pushes, and lists it in opengame.org's link
files for `/play/__OGS_APP_ID__`.

### 3. Push credentials

```bash
ogs push credentials --ios secrets/AuthKey_<KEYID>.p8 --key-id <KEYID> --team-id __OGS_APPLE_TEAM_ID__
ogs push credentials --android secrets/firebase-service-account.json
```

OGS stores them encrypted and prints what is configured, never the key.

### 4. Build with EAS

```bash
pnpm add -g eas-cli
eas login
eas init                                     # links this folder to an EAS project
eas build --profile preview --platform ios   # a store build for TestFlight
eas submit --profile preview --platform ios  # uploads it to App Store Connect
```

`preview` builds go to **TestFlight** (internal testers, no review) and to Google Play's
**internal testing** track (`eas build --profile preview --platform android`, then
`eas submit --profile preview --platform android` with a Play service account key at
`secrets/play-service-account.json`). `production` is the same build for the stores. Add
`"ascAppId"` to `submit.*.ios` in `eas.json` once App Store Connect has the app, so submits
never ask. Build numbers go up on every build (`autoIncrement`).

### 5. App Review

Fill in [`REVIEW_NOTES.md`](REVIEW_NOTES.md) and paste it into App Store Connect → App Review
Information → Notes. It explains why this is an app and not a website (guideline 4.2) and how
the reviewer tests casting, push and sign-in.

### 6. Links on your domain

Serve [`link-files/.well-known/`](link-files/README.md) on each of your link domains
(`__OGS_LINK_DOMAINS__`), then check everything:

```bash
ogs doctor
```

It checks the registration, push credentials, opengame.org's and your domain's link files, and
that your manifest's `tvUrl` answers.

## Keeping it up to date

- Your game: deploy the web game. The app loads it.
- The shell: `pnpm up @open-game-system/shell`, then a new build. Shell releases follow the OGS app.
- The Expo SDK: the shell pins the SDK it supports; upgrade both together.

## Help

- Docs: https://ogs-docs.pages.dev/ship-your-own-app (Markdown for agents: `/ship-your-own-app.md`, `/llms.txt`)
- The OGS contract your game already follows: https://ogs-docs.pages.dev/contract
