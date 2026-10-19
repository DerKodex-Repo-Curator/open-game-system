# __OGS_APP_NAME__ for iOS and Android

This is **__OGS_APP_NAME__** as its own app, under your name, icon and store listing. It opens your
game's phone page (`__OGS_GAME_URL__`) and gives it the native powers of the OGS app through
[`@open-game-system/shell`](https://ogs-docs.pages.dev/ship-your-own-app):

| Your page gets | How |
|---|---|
| **Play on TV** (Chromecast or a browser TV) | Your own button with `cast-kit-react`; the app runs the native picker and session. The TV shows your manifest's `tvUrl` full screen. |
| **Who is playing** | `useOgsProfile()` from `profile-kit`: a guest profile from the first launch, then **Sign in with Apple / Google** in a native sheet. One OGS account works in every OGS-powered app. |
| **Push links** | Your server sends one call; OGS delivers it to this app with your own APNs key / FCM account. A tap opens the page you name. |
| **Links** | `__OGS_LINK_BASE__/…`, `opengame.org/play/__OGS_APP_ID__/…` and `__OGS_APP_ID__://<path>` (the app's scheme, for tests) open the app at that page. |
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

## What needs an account

| Step | What you need |
|---|---|
| Run the app in the iOS Simulator or an Android emulator | **No account.** A Mac with Xcode for iOS; Android Studio for Android. |
| Profiles (`useOgsProfile()`) in your page | Your game **in the OGS catalogue** under the app id `__OGS_APP_ID__`. Until then your page gets `null`, as in a plain browser, and everything else works. |
| Run it on your own iPhone, TestFlight, the App Store | An **Apple Developer** account (99 USD a year) and your Team ID in `app.config.ts`. |
| Builds in the cloud, TestFlight and Play uploads | An **EAS** account (expo.dev, free tier) and `eas login`. |
| Push links, sign-in with Apple / Google, your own link domain | Your game's OGS API key and the `ogs` CLI (`ogs login`, then `ogs apps register`). |

## Run it in the simulator

You need Node 20+, pnpm, and for iOS: Xcode with an iOS Simulator and
[CocoaPods](https://cocoapods.org) (`brew install cocoapods`). For Android: Android Studio with an
emulator (`ANDROID_HOME` set, as Android Studio's setup says).

Install the app's packages:

```bash
pnpm install
```

Build the app and open it in the iOS Simulator:

```bash
pnpm ios
```

The first build takes 5 to 10 minutes (CocoaPods, then Xcode); later ones take a minute or two. It
uses the simulator that is open, or starts one. To choose one, name it:

```bash
pnpm ios --device "iPhone 17"
```

On Android, with an emulator running (or one Android Studio can start):

```bash
pnpm android
```

The app opens on Expo's **developer menu** the first time: tap **Continue**, and your game is
there. It is a development build (casting and push are native, so not Expo Go): the JS server
keeps running in the terminal, and the gear button on screen opens that menu again. Next time,
with the app already installed, start just the JS server:

```bash
pnpm start
```

The build prints warnings from Xcode, CocoaPods or Gradle about packages' deployment versions and
deprecated APIs. They come from React Native and Expo libraries, not from your app, and need
nothing from you. A `› Build Succeeded` / `BUILD SUCCESSFUL` line is what counts.

**Profile `null`?** Your page gets `null` from `useOgsProfile()` (and the app's log says
`"__OGS_APP_ID__" is not in the OGS catalogue yet`) until your game is listed: see
[Submit to the catalogue](https://ogs-docs.pages.dev/art-and-catalogue#submit-to-the-catalogue).
Your page works as it does in a plain browser meanwhile.

**Your local game.** The app opens `__OGS_GAME_URL__`. To point it at your game on your machine,
set `gameUrl` in `app.config.ts` to a URL the simulator can reach. An https tunnel works on a
phone too:

```bash
cloudflared tunnel --url http://localhost:5173
```

Then build again with `pnpm ios`.

What works where:

| | Simulator / emulator | Real phone |
|---|---|---|
| The game, profile, sign-in sheet, offline screen | yes | yes |
| Casting | no Chromecast discovery in the iOS Simulator (**Use a browser TV** works); the Android emulator can see TVs on its network | yes |
| Push | iOS Simulator: no remote pushes from APNs; Android emulator with Google Play: yes | yes |

## On your own iPhone

A real iPhone needs an **Apple Developer** account. Put your Team ID (developer.apple.com →
Membership, 10 characters) in `app.config.ts` as `ios.appleTeamId`, and in `eas.json` under
`submit.preview.ios` and `submit.production.ios` as `"appleTeamId"` if create-ogs-app left it out.

Without TestFlight, a development build goes to your phone from EAS. Register the phone once:

```bash
eas device:create
```

Then build and install it from the link EAS prints:

```bash
eas build --profile development --platform ios
```

## Cast to the TV

Casting is **your** button on **your** phone page, styled like your game:
[`examples/web/cast-button.tsx`](examples/web/cast-button.tsx). The shell answers it with the
native Chromecast picker and session; the TV loads the OGS Cast receiver, which shows your
manifest's `tvUrl` full screen with nothing around it, and your TV page gets the couch through
`ogs:start` as it does in the OGS launcher. A room game names the TV page for its room with
`useCastViewUrl(url)`.

The button shows even with no Chromecast on the Wi-Fi: the picker it opens offers **Use a browser
TV** (open `ogs-tv.pages.dev` in the TV's or a laptop's browser and type the code it shows), so
you can test casting in the iOS Simulator too.

Inside the OGS app the same page shows no cast button (OGS casts once for every game): the
example checks `inOwnApp()` ([`examples/web/in-own-app.ts`](examples/web/in-own-app.ts)). This app's
WebView adds `OgsShell/__OGS_APP_ID__` to the user agent; a plain browser and the OGS app don't.

## Profiles and sign-in

Your page reads the player with `useOgsProfile()` ([`examples/web/player-badge.tsx`](examples/web/player-badge.tsx)):

- `undefined` for a moment while the app answers, then a profile `{ id, handle, name, avatar, token }`.
- From the first launch the player is a **guest** with a real OGS profile, so your game works at
  once. Signing in with Apple (or Google on Android) happens in the app's native sheet, never in
  your page; it keeps the guest's profile, or switches to the player's existing OGS profile.
  Key your saves on `profile.id`.
- `profile.login` is `"guest"` until the player signs in, then `"apple"` or `"google"`. Show a
  "Sign in" button to guests that calls `requestOgsSignIn()` (profile-kit): the app opens its native
  sheet, and the signed-in profile arrives through `useOgsProfile()` by itself.
- `null` in a plain browser, and in this app while your game is not in the OGS catalogue: ask for
  a name as you do today.
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

Each step once per app, in this order. Every step here needs the accounts in
[What needs an account](#what-needs-an-account).

### 1. Apple and Google accounts

- [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list): register the
  bundle id `__OGS_BUNDLE_ID__` (team `__OGS_APPLE_TEAM_ID__`) with **Push Notifications**, **Sign in with
  Apple** and **Associated Domains**. (`eas build` can create it; check the three capabilities.)
- Create an APNs key (Keys → +, Apple Push Notifications service). Download `AuthKey_<KEYID>.p8`
  once and keep it out of git (`.gitignore` already ignores `*.p8` and `secrets/`).
- Google Play Console (when you ship Android): create the app for `__OGS_ANDROID_PACKAGE__`.

### 2. Tell OGS about the app

Install the OGS CLI:

```bash
pnpm add -g @open-game-system/cli
```

Log in with your game's OGS API key, the one your server uses to send pushes (`OGS_API=<url>`
points the CLI at a preview API):

```bash
ogs login --app __OGS_APP_ID__ --key ogsk_…
```

Register the iOS app:

```bash
ogs apps register --ios __OGS_BUNDLE_ID__ --team-id __OGS_APPLE_TEAM_ID__
```

Register the Android app, with the SHA-256 that `eas credentials` shows after the first Android
build:

```bash
ogs apps register --android __OGS_ANDROID_PACKAGE__ --sha256 <SHA-256> --google-client-id <id>.apps.googleusercontent.com
```

Registering lets OGS accept this app's sign-ins and pushes, and lists it in opengame.org's link
files for `/play/__OGS_APP_ID__`.

### 3. Push credentials

iOS, with the APNs key from step 1:

```bash
ogs push credentials --ios secrets/AuthKey_<KEYID>.p8 --key-id <KEYID> --team-id __OGS_APPLE_TEAM_ID__
```

Android, with the Firebase service account key:

```bash
ogs push credentials --android secrets/firebase-service-account.json
```

OGS stores them encrypted and prints what is configured, never the key.

### 4. Build with EAS

Install the EAS CLI:

```bash
pnpm add -g eas-cli
```

Log in to your Expo account:

```bash
eas login
```

Link this folder to an EAS project:

```bash
eas init
```

Make a store build for TestFlight:

```bash
eas build --profile preview --platform ios
```

Upload it to App Store Connect:

```bash
eas submit --profile preview --platform ios
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
