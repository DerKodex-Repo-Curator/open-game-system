# Status: BUILT 2026-10-18 (branch claude/second-visit-0e55ec; not deployed); e2e e2e/second-visit-preview.ts passes. Audit:
# docs/second-visit-audit.md. Goal: a household that played once is back in a round in under 10 s.

Feature: The second visit

  Background:
    Given the Okafors played Rocket Crew yesterday on their laptop-on-the-TV (a browser TV)
    And Dana hosted from her phone and Grandma joined from her phone's browser

  Scenario: The app opens where they left off
    When Dana opens OGS today
    Then she is on her profile without onboarding
    And the Library's first game is Rocket Crew

  Scenario: The TV is remembered on both sides
    Given the laptop still has the TV page open, or opens it again
    Then the TV page shows the same code as yesterday
    And Dana's Cast button already picks that TV, without typing the code
    And this holds after Dana's phone restarted the app

  Scenario: Play again on the TV
    When Dana casts to the TV
    Then the TV home's first card is "Play again" for Rocket Crew, played yesterday
    And Rocket Crew is the first game in the TV's row of games
    When Dana presses OK on it
    Then Rocket Crew starts a new game on the TV, and every phone on the couch follows into it

  Scenario: Grandma joins again in one tap
    When Grandma scans the TV's QR code with the same phone as yesterday
    Then the join page offers "Join as Grandma" with her sticker, already filled in
    And one tap puts her on the couch

  Scenario: Invite last week's players
    Given Lee joined Dana's couch from the OGS app within the last 7 days
    When Dana opens "Invite last week's players" while casting
    Then Lee is listed
    When Dana taps Invite next to Lee
    Then Lee's phone gets a notification that opens the join page of Dana's couch
    And people who never shared a couch with Dana can't be invited this way

  Scenario: Back in a round the next day (e2e, the clock moved a day forward; measured 17.6 s against the 10 s goal)
    Given a session was played, then the app, the TV page and the guest's page were all closed
    When the clocks move a day forward and everyone opens them again
    Then Dana reaches Rocket Crew's first round in at most 5 taps (4 when the TV offers Play again)
    And Grandma is the Fixer again
