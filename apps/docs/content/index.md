# Build a game for OGS

OGS (Open Game System) puts web games on the living-room TV. A grown-up casts **once** from the OGS
app; after that the TV shows one page for as long as the cast lasts, the **TV launcher**, and every game plays inside
it. Phones and iPads join the couch and play each game's phone page. Your game stays an ordinary web
game: it gets a few `postMessage`s and a small library, and it keeps working in a plain browser.

> **Building with a coding agent?** Paste this one line into it, in your game's repository:
>
> `Make this game OGS-compatible: follow https://ogs-docs.pages.dev/llms.txt`
>
> Starting fresh? The [starter template](starter.md) already works with OGS. Every page here is also
> plain Markdown: add `.md` to its URL.

## How it works

1. **Cast once.** The host opens the OGS app and casts to the TV (Chromecast, or any browser on the
   TV). The TV shows the launcher and a 6-character **TV code**.
2. **Phones join the couch.** Everyone else joins with the TV code. Each person has an OGS profile:
   a name and an avatar.
3. **The launcher frames your game.** When someone picks your game, the launcher loads your **TV page**
   in an iframe and tells it who is on the couch. Swapping games never recasts.
4. **Phones open your phone page.** The app opens your game's `startUrl` in a WebView. Your page asks
   profile-kit who is playing and skips its own name form.
5. **Home parks your game.** When the couch goes Home or switches games, the launcher keeps your frame
   loaded but parked, and tells you to go silent. Continue brings the same frame back instantly.

## Your two pages

| Surface | Where it runs | What it does with OGS |
|---|---|---|
| **TV page** | In an iframe filling the TV launcher (test it at 1280×720 and 1920×1080) | Hears `ogs:start` (who's on the couch, a game token), `ogs:suspend` / `ogs:resume` (parked or back); may report the sitting's label |
| **Phone page** (`startUrl`) | In the OGS app's WebView on phones and iPads | Reads the OGS profile (name, avatar, game token) through the app bridge; reports the sitting's label |

A game with one static TV page lists it as `tvUrl` in its manifest. A room-based game (each room has
its own TV URL) declares the room's TV page from the phone page at runtime. Either way the game never
casts: OGS does.

## What your game gets

- **Who's playing.** On the phone: the player's OGS name, avatar and a **game token**. On the TV: the
  whole couch (`players`) and a game token for the session. No sign-up, no name form.
- **Verified identity.** Game tokens are ES256 JWTs signed by OGS for your game only (`aud` = your
  appId). Your server checks them with one call, `verifyOgsToken`.
- **Sitting labels.** Report "Mission 6" or "Room KQTP" and the OGS app shows it in Playing, so two
  sittings of your game read apart.
- **Pause and resume.** A clear signal when the TV parks your game and when it comes back, so you can
  stop the music and keep state.
- **Casting handled.** No cast SDK, no cast button, no receiver app, no join codes on the TV.
- **Several couches in one room** (optional, `multiCouch`): households in different homes play one
  room of your game.

## What OGS asks of you

The short version of [the rules](rules.md):

- No cast button and no room code or join QR on an OGS TV.
- Nothing covers the TV's focal area; stay inside the safe area.
- Silent while parked.
- Still playable in a plain browser, where every profile-kit call returns `null` or does nothing.

## Where to go next

- [Quickstart for agents](quickstart.md): the step-by-step checklist.
- [Starter template](starter.md): a small game that already does all of it.
- [The game contract](contract.md): the single source of truth.
- [profile-kit reference](profile-kit.md) and [Messages and manifest](messages.md): exact APIs.
- [Testing your game](testing.md), [Art kit and catalogue](art-and-catalogue.md).
