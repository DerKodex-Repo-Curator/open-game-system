# Rules and taste

What every OGS game does, and why. The binding list is [§5 of the contract](contract.md#5-rules);
this page explains each rule and how to check it.

## 1. No cast button

OGS casts once and keeps that one cast across every game; the launcher frames your game. A game never starts a cast,
never shows a cast button or a "cast to TV" prompt, and never ships a cast receiver for OGS. Inside
the OGS app the app ignores a game's own cast actions anyway.

The one exception is your game's **own app** (built with `@open-game-system/shell`): there the cast
button is yours, and it shows only there. See [Ship your game as its own app](ship-your-own-app.md).

**Check:** search the phone page for a cast button and remove it; room games keep only
`useCastViewUrl` (see [Quickstart, step 8](quickstart.md#8-room-games-declare-the-tv-page-from-the-phone)).

## 2. No join codes on an OGS TV

People join the couch with the launcher's TV code; phones already land in your game. On an OGS TV,
show no room code, no join QR, no "join at …" URL. Outside OGS (a plain browser) keep them: that is
how people join there.

**Check:** framed after `ogs:start` there is no code or QR; opened directly there is.

> Planned ([contract §8](contract.md#8-joining-and-invites-planned)): the launcher will draw its own
> join QR and an invite card in one corner, and a game may ask for it with `ogs:invite`. Keep that
> corner (top-right by default, at most 220×120 px on a 960×540 reference with a 24 px margin) free of
> your focal area and HUD.

## 3. Nothing over the focal area

The TV is the shared screen everyone watches from the sofa. Whatever the game is about right now
(the board, the character, the question) stays uncovered: HUD, scores and toasts live at the edges,
small and brief.

**Check:** screenshots of every phase at 1280×720 and 1920×1080; nothing overlaps the focal element.

## 4. Inside the safe area

TVs crop their edges. Keep every element that matters at least **5%** in from each edge of the TV
page, and remember that a focus or hover `scale()` grows an element past that line: scale it away from
the edge.

**Check:** at 1280×720, 1920×1080 and 3840×2160, every visible element's bounding box is inside the
5% inset.

## 5. Silent while parked

Home or another game parks your frame: it stays loaded so Continue is instant, so its sound keeps
playing unless you stop it. On `ogs:suspend` (`onOgsPause(true)`) suspend the `AudioContext`, pause
media, and stop anything that would start a sound. On `ogs:resume` resume only what was playing.

**Check:** the [pause seam test](testing.md#1-the-tv-page-in-a-stand-in-launcher).

## 6. Starts without a tap

There is no pointer or keyboard on the TV. The TV page starts, plays sound and animates on load, and
is driven entirely from the phones. No "click to start", no full-screen button when framed.

## 7. Still a plain web game

Without OGS the game is complete: its own name form, room code and TV link, and full play end to end.
Every profile-kit call returns `null` or does nothing there, so keep your own path behind those
`null`s.

**Check:** the [plain-browser test](testing.md#3-still-a-plain-browser-game).

## 8. Trust only verified tokens

Use `verifyOgsToken` on your server for anything that matters: seats, scores, names other people
see. A game sees only **game tokens for itself**, never the app's or the launcher's own token. A
token tells you a profile id, handle, name and avatar, and on a TV the couch: never friends, other
games, device ids or age. Don't ask for more.

## 9. Phones: the OGS profile replaces your name form

Inside the OGS app, join under the OGS name and avatar without a form, and hide your own join-code
entry. Join once per seat; the app refreshes the token and a new token must not join again.

## 10. Notifications only when it helps

A push is for someone who isn't looking: their turn in a game that runs over days, a round waiting on
them, another couch joining their room. Send at most one per handoff, never to a player connected to
your room, never to a kid (OGS refuses anyway), and never a streak or "come back and play" nag. Ask for
permission from a tap, at the moment it is useful, once. See [Notifications](notifications.md).

**Check:** your server's send is only called from handoffs, and a seam test shows a connected seat gets no
push.

## Taste

- Your game's own look: don't copy another OGS game's art direction.
- No faces on objects (rockets, planets, props).
- Big, legible type on the TV, read from a sofa three metres away.
- Phones and iPads are controllers: big targets where thumbs rest, near the bottom edge.
