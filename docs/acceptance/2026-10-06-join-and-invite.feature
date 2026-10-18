# Status: PLANNED, except "Home shows the QR next to the TV code" and "Getting ready shows the same card"
# (built 2026-10-17: apps/tv/src/ui/JoinCode.tsx, e2e apps/tv/e2e/join-qr.e2e.ts decodes the QR off the TV;
# the link is ogs-protocol join.ts); "Scanning with the app installed opens the app" and "An expired or unknown
# code" (built 2026-10-17: opengame.org/join/<code> apps/web/src/pages/Join.tsx + GET /api/v1/join/:code; the app
# holds a join link through onboarding, apps/mobile/e2e/first-time-funnel.test.ts), and except "Every phone follows the TV" (built 2026-10-06 for app phones and kids' iPads: couch session
# reducer packages/ogs-protocol/src/session.ts, app apps/mobile/services/couch-follow.ts; tests in
# session.rules.test.ts "every phone follows the TV" + "kids' iPads follow the TV" + "which phone's TV page
# the launcher frames", couch-follow.test.ts, the API integration
# couch.test.ts, and e2e/phones-follow.mjs). Browser guests (Grandma) follow once the web join page exists.
# Spec: docs/product-specs/ogs-join.html. Contract: docs/specification.md §8. ADR: docs/adrs/2026-10-06-launcher-owns-joining.md.
# Design canvas: https://claude.ai/artifact/5CoghVnLznn5pSdENvazJM (TV-Home-QR, Phone-Web-Join, Phone-Joined,
# TV-Game-Invite, Game-Lobby-Transfer). Several households in one room: 2026-10-05-multi-couch.feature.

Feature: Joining and inviting is the launcher's job

  Background:
    Given Jonathan has cast his TV and the couch session has TV code "NT9WPH"

  # --- The join QR ---

  Scenario: Home shows the QR next to the TV code
    When the launcher shows Home
    Then a card shows a QR code, "Scan to join, or type", "NT9WPH" and "opengame.org/join"
    And the QR encodes "https://opengame.org/join/NT9WPH"
    And the card is at the bottom-right and does not cover the focus row or the couch avatars

  Scenario: Getting ready shows the same card
    When the launcher shows Getting ready
    Then the same QR and code are shown

  Scenario: Typing the code still works
    When Sam types "NT9WPH" in the OGS app's Join with TV code
    Then Sam is on the couch

  Scenario: Scanning with the app installed opens the app
    Given Sam has the OGS app
    When Sam scans the QR with the phone camera
    Then the OGS app opens and Sam is on the couch as himself

  # Added 2026-10-17 (first-time funnel): the guest who scans is usually new to OGS.
  Scenario: A first scan on a phone that just installed the app
    Given Sam has just installed the OGS app and has no profile
    When Sam scans the QR and the link opens the app
    Then onboarding comes first
    And once Sam's profile is made, Sam is on the couch without scanning again
    And Sam's phone shows the remote

  Scenario: An expired or unknown code
    When a phone opens "https://opengame.org/join/ZZZZZZ"
    Then it says the couch isn't on any more and offers a field to type another code
    And nobody is added to any couch

  # --- Guests from the browser ---

  Scenario: A guest joins from the browser without the app
    Given Grandma has no OGS app
    When Grandma scans the QR
    Then a web page "Join the couch" shows the TV's name and who is already there
    And it asks for a name and a picture
    When Grandma enters "Grandma", picks a sticker and taps Join
    Then Grandma is on the couch as a guest
    And the TV shows her among the people on the couch
    And her phone shows the remote

  Scenario: The join page offers the app but never requires it
    When Grandma sees the join page
    Then "Have the OGS app? Open it instead" is offered
    And Join works without installing anything

  Scenario: A guest gets a game token marked as a guest
    Given Grandma is on the couch as a guest and Rocket Crew starts
    Then ogs:start's players include Grandma with her name and sticker
    And the game token for her has guest true and a per-session sub, no handle
    And no friends, device id or push token are in it

  Scenario: A guest keeps nothing after the couch ends
    When the couch session ends
    Then Grandma's guest profile is gone and she has no sittings in any app

  Scenario: The app is the upgrade
    Given Grandma is on the couch as a guest
    When she taps "Get the app" and makes an OGS profile
    Then her name and sticker are offered as the starting profile
    And when the app joins the same couch the guest entry is replaced by her profile
    And she is on the couch once

  # --- Every phone follows the TV (built for app phones) ---

  Scenario: On Home every phone is a remote
    Given Sam (app) and Grandma (browser) are on the couch
    When the TV is on Home
    Then both phones show the remote

  Scenario: A game starts and every phone opens it
    When Dad starts Rocket Crew from the TV
    Then Sam's phone and Grandma's phone both open Rocket Crew's phone page
    And nobody taps Join

  Scenario: A phone that joins mid-game lands in the game
    Given Rocket Crew is running
    When Grandma joins from the QR
    Then her phone opens Rocket Crew's phone page

  Scenario: Home brings every phone back
    When someone presses Home
    Then every phone is back on the remote and the game is parked

  Scenario: Switching games swaps every phone
    When Night Flight starts while Rocket Crew is current
    Then every phone opens Night Flight's phone page

  Scenario: A phone that stepped out is not dragged back by updates
    Given Sam went back to the remote while Rocket Crew runs
    When the TV's state changes but the current game does not
    Then Sam's phone stays on the remote

  Scenario: Stepping out does not park the game for everyone
    Given Dad started Rocket Crew and Sam's phone followed it
    When Sam swipes back to the remote
    Then Rocket Crew keeps playing on the TV and Dad's phone stays in it
    When Dad swipes back
    Then Rocket Crew is parked, as before

  # Rooms: any room-based game, multiCouch or not (spec §3, §7)

  Scenario: A following phone joins the TV's room, not a new one
    Given Dad's phone started Rocket Crew and the TV page says ogs:room "KQTP"
    Then Sam's phone opens Rocket Crew's start page with ogsRoom=KQTP
    And Rocket Crew's room KQTP has two seats taken: Dad's and Sam's

  Scenario: A room-based game's phones wait for the room
    Given Rocket Crew makes its own rooms (no static TV page)
    When Dad starts it and the TV page has not said ogs:room yet
    Then Sam's phone stays on the remote
    And when the TV page says ogs:room "KQTP" Sam's phone opens the game in room KQTP

  Scenario: Tapping the game the TV is playing joins its room
    Given Rocket Crew is playing in room "KQTP" and Sam stepped out to the remote
    When Sam taps Rocket Crew
    Then Sam's phone opens Rocket Crew's start page with ogsRoom=KQTP
    And the TV keeps the same sitting

  Scenario: A follower's game reports label the couch's sitting
    Given Sam's phone followed Rocket Crew into room "KQTP"
    When its page reports its sitting over the bridge
    Then it is filed under the couch's live sitting, and the game's page lists one sitting

  # Changed 2026-10-06 (v3 spec: kid iPads follow the TV): an iPad not in the roster used to stay on
  # the remote, and no client sends a roster, so the kids' iPads never followed.
  Scenario: Kids' iPads follow the TV like every phone
    Given Juneau's and Ava's iPads are on the couch and no roster was sent
    When Dad starts Rocket Crew and the TV page says ogs:room "KQTP"
    Then both iPads open Rocket Crew's start page with ogsRoom=KQTP, as players
    And when someone presses Home both iPads are back on the remote

  Scenario: An iPad in the roster keeps its seat
    Given Juneau's iPad is in the roster as the Fixer
    When Rocket Crew starts
    Then Juneau's iPad opens it as the Fixer, and an iPad not in the roster opens it as a player

  Scenario: Only the host's game page picks the TV page
    Given Dad's phone hosts Rocket Crew and the TV frames its TV page
    When Sam's phone or Juneau's iPad follows into the game and its page asks for its TV view
    Then the TV keeps Dad's TV page

  # --- Mid-game invite ---

  Scenario: A phone taps Invite and the TV shows a corner card
    Given Rocket Crew is running and its manifest says inviteCorner "top-right"
    When Sam taps Invite someone
    Then the launcher shows a card with a QR, "Join this game" and "NT9WPH" in the top-right corner
    And the card hides after 30 seconds

  Scenario: The game asks for an invite
    Given Trivia Jam is waiting for players
    When its TV page sends ogs:invite
    Then the launcher shows the same card in Trivia Jam's safe corner

  Scenario: The card is never over the focal area
    When the invite card is shown
    Then it stays within the manifest's corner, at most 220 by 120 px on a 960 by 540 reference
    And no other part of the game's frame is covered

  Scenario Outline: The manifest picks the corner
    Given a game's manifest says inviteCorner "<corner>"
    When the invite card is shown
    Then it is in the <corner> corner

    Examples:
      | corner       |
      | top-right    |
      | top-left     |
      | bottom-right |
      | bottom-left  |

  Scenario: A game with no inviteCorner gets top-right
    Given a game's manifest has no inviteCorner
    When the invite card is shown
    Then it is in the top-right corner

  Scenario: Repeated invites restart the timer
    Given the invite card is shown
    When ogs:invite arrives again
    Then there is one card and it hides 30 seconds after the latest trigger

  Scenario: Scanning the card puts the guest in the running game
    When Grandma scans the card's QR
    Then she joins the couch and her phone opens the running game

  Scenario: Messages from a game that is not current are ignored
    Given Rocket Crew is parked and Night Flight is current
    When Rocket Crew's frame sends ogs:invite
    Then no card is shown

  # --- Games never draw join codes ---

  Scenario: A game shows no join UI inside OGS
    Given Trivia Jam is framed by an OGS TV
    Then its TV page shows no room code, QR or "join at" text

  Scenario: Outside OGS a game keeps its own join UI
    When Trivia Jam is opened in a plain browser
    Then it shows its own room code and QR

  # --- Transfer link ---

  Scenario: A game's own site offers Play on TV with OGS
    Given Priya opens triviajam.tv/room/KQTP in a plain browser
    Then the page shows "Play on TV with OGS" linking to "https://opengame.org/play/trivia-jam?room=KQTP"

  Scenario: The link is hidden inside OGS
    When the same page is opened in the OGS app's WebView
    Then "Play on TV with OGS" is not shown

  Scenario: The link with the app and a cast starts the game in the room
    Given Priya has the OGS app and a cast TV
    When she opens the transfer link
    Then game.start is sent for "trivia-jam" with room "KQTP"

  Scenario: The link with no cast asks to cast first
    Given Priya has the OGS app and no cast
    When she opens the transfer link
    Then the app asks her to cast first, then starts Trivia Jam in room "KQTP"

  Scenario: The link without the app says how to get it
    When a phone without the app opens the transfer link
    Then opengame.org says how to get OGS

  Scenario: The link without a room just starts the game
    When the app opens "https://opengame.org/play/trivia-jam"
    Then Trivia Jam starts with no room and makes its own

  # --- Households ---

  Scenario: Another household is not a guest
    Then adding the Smiths' couch to the room is the friend invite in 2026-10-05-multi-couch.feature
    And the join QR adds a phone to this couch only
