# Status: BUILT 2026-10-18 (branch claude/first-time-funnel-0e55ec; not deployed). Tests: API
# services/api/test/family-invite-routes.test.ts; protocol family-invite.test.ts; app link-routing, app-state,
# ogs-api, invite-attribution, invite-family tests; e2e across two households on the preview:
# e2e/invite-family-preview.ts (all steps counted on the invite). Bet 1 of the usage-burn plan:
# households bring households. Audit: docs/funnel-audit.md.
# Funnel events (wide events in Workers Logs, one invite_id through all four):
#   funnel.invite_sent → funnel.link_opened → funnel.testflight_tap → funnel.first_session

Feature: Invite another family at the end of a session

  Background:
    Given the Okafors played Rocket Crew on their TV tonight

  Scenario: The end of a session offers the invite
    When Dana stops casting
    Then the TV tab says "Stopped casting" and offers "Invite another family"

  Scenario: The invite is a link to the game
    When Dana taps "Invite another family"
    Then a link "https://opengame.org/play/rocket-crew?inv=<invite>" is shown with Share
    And the API logs funnel.invite_sent with the invite, Dana's profile and the game

  Scenario: The other family opens it without the app
    When the Lees open the link in a browser
    Then the page names Rocket Crew and offers "Open in the OGS app" and how to get the app
    And the API logs funnel.link_opened for the invite
    When they tap "Get OGS"
    Then the API logs funnel.testflight_tap for the invite

  Scenario: Their first couch counts for the invite
    Given the Lees installed OGS from the link and opened Rocket Crew's page through it
    When they cast for the first time
    Then the API logs funnel.first_session for the invite with the Lees' profile and session
    And Dana's invite says they played

  Scenario: Only a first couch counts, once
    When the Lees cast again, or Dana casts with her own invite
    Then no funnel.first_session is logged

  Scenario: The invite's page tells nobody who sent it
    Then the page and the invite's counts name no profile, no @id and no family
