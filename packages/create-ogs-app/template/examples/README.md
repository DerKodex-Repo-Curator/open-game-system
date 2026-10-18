# Examples for your web game

These files are for **your game's web code**, not this app: copy what you need. They work the
same in this app, in the OGS app and in a plain browser.

```bash
pnpm add @open-game-system/cast-kit-react @open-game-system/profile-kit   # the phone page
pnpm add @open-game-system/notification-kit-server                        # the game server
```

| File | What it shows |
|---|---|
| [`web/cast-button.tsx`](web/cast-button.tsx) | "Play on TV" with `cast-kit-react`: your button, the native picker and session, the TV page for a room |
| [`web/in-own-app.ts`](web/in-own-app.ts) | Telling this app apart from the OGS app and a browser (only this app shows a cast button) |
| [`web/player-badge.tsx`](web/player-badge.tsx) | The player's name and avatar with `useOgsProfile()`; a name form in a plain browser |
| [`web/phone-page.tsx`](web/phone-page.tsx) | A tiny phone page using all of it, plus "Ping me when it's my turn" |
| [`server/send-push-link.ts`](server/send-push-link.ts) | Your server sends "Your turn" with a link that opens the app on the room |

The full guide: https://ogs-docs.pages.dev/ship-your-own-app
