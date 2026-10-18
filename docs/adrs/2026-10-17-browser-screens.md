# 2026-10-17: Browser screens are a cast device, paired through the API

## Status

Accepted (owner direction: roadmap "Web + browser TVs (direct mode)", 2026-10-04; built on the
first-time funnel branch).

## Context

12 of 13 catalogue games need a TV, and the only TV path was Google Cast to a custom receiver that
streams a cloud-rendered launcher (Cloud Run L4). Cast reaches ~10–15% of TVs; a stranger without a
Chromecast could not play (docs/funnel-audit.md #2). Any TV with a laptop on HDMI, a games console
or a smart-TV browser can run the launcher itself: the launcher is a web page, and it already frames
each game's TV page.

## Decision

- A **screen** is a browser showing the TV page (`apps/tv` with no query). It asks the API for a
  screen (`POST /api/v1/screens`: id, code, secret; no token), shows the code, and polls
  `GET /api/v1/screens/:id` with its secret.
- A phone **claims** it by typing the code (`POST /screens/claim`); the screen is then one of that
  phone's TVs, next to its Chromecasts, in the same cast backend (`CastBackend`): the app's cast
  flow, couch session and game starts don't change.
- Casting to it sends the **launcher token** (the one LOAD_VIEW carries to a Chromecast) through
  `POST /screens/:id/show`; the API accepts only a launcher token for a couch the caller hosts. The
  screen boots the launcher in its own page, against its own API base (never a URL from the phone).
- **Direct mode**: no cloud stream. The launcher and games run in that browser.

## Consequences

- No Chromecast, receiver publishing or GPU needed for these households; no stream cost.
- The TV's browser must be good enough for the games' TV pages (3D games on a smart-TV browser may be
  slow; a laptop is fine). Sound needs one click on the page (autoplay rules): the pairing page asks
  for it.
- Polling every 2 s while waiting; a WebSocket can replace it later without changing the API shape.
