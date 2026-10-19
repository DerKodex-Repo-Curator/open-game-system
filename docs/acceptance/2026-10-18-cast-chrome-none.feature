# Status: SHIPPED 2026-10-19 (main d2897aca: API + schema by CI; opengame.org, ogs-tv, ogs-docs deployed).
# Design: docs/design-docs/white-label-shell.md (decisions 2a and 10).
# The Chromecast shows the cloud-rendered page the sender loads (apps/web/public/receiver.html,
# LOAD_VIEW). A white-label app loads the launcher (apps/tv) with chrome=none and its appId.

Feature: A white-label app casts its game's TV page, with no OGS launcher around it

  Scenario: Casting from Rocket Crew's app shows Rocket Crew's TV page full screen
    Given Rocket Crew's manifest has tvUrl "https://rocket-crew.example/tv"
    When the launcher opens with a launcher token, chrome "none" and app "rocket-crew"
    Then it shows "https://rocket-crew.example/tv" in a full-screen frame
    And there is no home screen, game page, people row, join code or OGS mark

  Scenario: The game still gets its couch
    Given the launcher runs with chrome "none"
    Then the game's frame gets ogs:start with the couch session, as inside the OGS launcher

  Scenario: The phone changes the TV page
    Given the launcher runs with chrome "none"
    When the phone's game page declares another TV page (game.view)
    Then the frame shows that page, still full screen with no launcher chrome

  Scenario: A game without a tvUrl
    Given a manifest without tvUrl
    When the launcher opens with chrome "none" for it
    Then it shows a plain black screen until the phone declares a TV page

  Scenario: Without chrome=none nothing changes
    When the launcher opens with only a launcher token
    Then it shows the OGS launcher as today

  # --- a browser TV paired by code (POST /api/v1/screens/:id/show { token, app? }) ---

  Scenario: A browser TV pairs by code and shows the game
    Given a browser TV showing its pairing code, claimed by the couch host's phone in a white-label app
    When the app casts with its launcher token and app "rocket-crew"
    Then GET /api/v1/screens/:id answers show { token, app: "rocket-crew" }
    And the screen shows only Rocket Crew's TV page, as chrome=none&app=rocket-crew does on a Chromecast

  Scenario: The OGS app's cast to a browser TV keeps the launcher
    Given a browser TV that showed a white-label app's cast
    When the OGS app casts to it with only a launcher token
    Then show has no app and the screen shows the whole OGS launcher

  Scenario: Stopping clears the chromeless app
    When the owner stops the screen
    Then it goes back to its code, and its next cast without an app shows the launcher
