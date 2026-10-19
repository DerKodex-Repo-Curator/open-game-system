# App Review notes: __OGS_APP_NAME__

Paste the part between the lines into App Store Connect → your app → App Review Information →
**Notes**, after filling in every `[bracket]`. Keep it under 4,000 characters. Put the demo
account in the **Sign-in information** fields too.

Why this matters: an app that mostly shows a website is rejected under guideline **4.2 (Minimum
Functionality)**. __OGS_APP_NAME__ is a game played on a TV with phones as controllers,
and the parts that make that work are native. Say so, and show the reviewer how to see each one.

---

__OGS_APP_NAME__ is [a party game played on a TV, with each player's phone as their controller].
The game's screens are web technology, rendered in the app; everything around them is native:

1. **Casting to the TV (Google Cast SDK).** Tap "[Play on TV]" on [the first screen]. The app
   uses the native Google Cast SDK to find Chromecast / Google TV devices on the local network
   (that is why it asks for Local Network access), shows the native device picker, and keeps the
   cast session running while players use their phones. [The TV shows the game board; the phones
   show each player's hand.]
2. **Push notifications (APNs).** After a player's first turn the game offers "[Ping me when it's
   my turn]". The app asks for notification permission with the system prompt. When another
   player moves, the player gets a push; tapping it opens the app straight at that game.
3. **Sign in with Apple.** Players start at once as a guest (the profile badge says "Guest").
   Tapping "Sign in" next to it opens the native Sign in with Apple sheet, which saves their
   profile, name and avatar so they carry to another device. There is no other sign-in method in the game and no account to create.
4. **Haptics.** Turns, buzzers and wins use the Taptic Engine.
5. **Offline screen.** With no connection the app shows a native screen with a Retry button
   instead of a broken page.
6. **Universal links.** Invitations (`__OGS_LINK_BASE__/…`) open the app at the right game.

**How to test**

- Demo account (Sign in with Apple is optional; guest play needs no account):
  [reviewer email / password, or "no account needed"].
- Casting needs a Chromecast or Google TV on the same Wi-Fi. If you don't have one, please see the
  video: [link to a 1-minute screen recording of casting and play].
- To see a push: [steps, e.g. "open the game link in Safari on a second device, join as a
  second player, play a turn; the first device gets 'Your turn'"]. We can also send one on
  request: [contact].
- Play a round: [two or three steps].

**What the app loads**

The game's screens come from __OGS_GAME_ORIGIN__ (our own game, the same team that publishes this
app). They only use the app's native features above through the app's own bridge; the app opens
no other websites, and links to other sites open in Safari. There are no in-app purchases, ads,
or tracking.

**Contact:** [name, email, phone]

---

## Before you submit

- [ ] Screenshots show the app on a phone **and** the TV during play (casting is the point).
- [ ] The demo video link works without signing in.
- [ ] Privacy Nutrition Label: the OGS profile (name, avatar, an id), push token. No tracking.
- [ ] `NSLocalNetworkUsageDescription` (set by the shell plugin) reads well for your game.
- [ ] Sign in with Apple works on a TestFlight build (capability on the bundle id).
- [ ] Turn off any debug or "test" UI in the web game for the build you submit.
- [ ] If a reviewer reports 4.2 anyway: reply in Resolution Center with the video and list the
      native features above; it is usually resolved there.
