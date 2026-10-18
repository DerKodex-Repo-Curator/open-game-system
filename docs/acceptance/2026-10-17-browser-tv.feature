# Status: BUILT 2026-10-18 (branch claude/first-time-funnel-0e55ec; not deployed). Tests: API
# services/api/test/screen-routes.test.ts; TV apps/tv/src/screen/pairing.test.ts; app
# apps/mobile/services/__tests__/screen-cast.test.ts; Detox apps/mobile/e2e/browser-tv.test.ts (the whole walk).
# Not covered by a test yet: "A paired screen stays paired" across days (the browser keeps the screen). Roadmap "Web + browser TVs
# (direct mode)". ADR: docs/adrs/2026-10-17-browser-screens.md. Audit: docs/funnel-audit.md #2.

Feature: Any TV with a browser is an OGS TV, no Chromecast needed

  Background:
    Given the Okafors have a laptop plugged into their TV and no Chromecast
    And Dana has the OGS app with a profile

  Scenario: The TV page shows a code to pair with
    When the laptop opens the OGS TV page
    Then it shows a 6-character code, "Open OGS on your phone, then TV › Use a browser TV" and "Click to go full screen"
    And the code works for an hour until a phone claims it

  Scenario: A phone with no Chromecast finds the browser TV way
    Given Dana's phone finds no Chromecast
    When Dana taps Play on a game
    Then the cast prompt says no TV was found and offers "Use a browser TV"

  Scenario: Pairing by typing the code
    When Dana taps "Use a browser TV" and types the code
    Then "Browser TV" is one of Dana's TVs, picked
    And Cast shows the OGS launcher on the laptop, with Dana's couch and TV code
    And the game Dana picked starts there

  Scenario: The browser plays the games itself
    When Dana casts to the browser TV
    Then no cloud stream starts: the launcher and the game's TV page run in the laptop's browser

  Scenario: Stop casting puts the code back
    When Dana stops casting
    Then the laptop shows its code again

  Scenario: A paired screen stays paired
    Given Dana paired the laptop yesterday
    When the laptop opens the TV page again and Dana casts
    Then the laptop shows the launcher without typing a code again

  Scenario: Only the phone that paired it casts to it
    Given Sam's phone did not type the laptop's code
    Then Sam cannot cast to it, and the launcher it shows is only ever Dana's couch's

  Scenario: The screen keeps no profile
    Then the laptop holds only a secret for its screen; the launcher token it shows is the couch's
