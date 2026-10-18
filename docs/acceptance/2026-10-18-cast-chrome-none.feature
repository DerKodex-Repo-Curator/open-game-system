# Status: BUILT on claude/shell-platform (apps/tv; not deployed).
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
