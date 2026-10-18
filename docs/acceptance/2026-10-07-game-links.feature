# Status: PARTLY BUILT on feat/game-push (2026-10-08): routing and the /play claim; the native build and
# a real device check are open. Scenario → test map: docs/exec-plans/active/2026-10-08-push-overnight-briefing.md. Checked 2026-10-07: opengame.org's association file and the Android
# intent filter cover only /open; triviajam.tv's covers only /games/*; triviajam.tv has no assetlinks.json;
# apps/mobile/services/deep-links.ts hard-codes triviajam.tv.
# 2026-10-18 (first-time funnel): a play link without a room ("An outside developer's domain goes through the
# play link") opens the app on that game's page, after onboarding on a fresh install; the site shows "Open in
# the OGS app" for it (ogs-protocol readGameLink; apps/mobile link-routing, app/play/[appId]; Detox
# e2e/first-time-funnel.test.ts).
# Spec: docs/product-specs/push-notifications.md "Taps and links". ADR: docs/adrs/2026-10-07-game-push-and-app-links.md.

Feature: A game's links open in the OGS app when it is installed

  Scenario: The play link opens the app on iPhone
    Given Sam has the OGS app on an iPhone
    When Sam taps "https://opengame.org/play/night-flight?room=KQTP" in Messages
    Then the OGS app opens and starts Night Flight in room "KQTP"

  Scenario: The play link opens the app on Android
    Given Sam has the OGS app on an Android phone
    When Sam taps "https://opengame.org/play/night-flight?room=KQTP" in Messages
    Then the OGS app opens and starts Night Flight in room "KQTP"

  Scenario: A first-party game's own link opens in the app at that page
    Given Sam has the OGS app
    When Sam taps "https://triviajam.tv/" in Messages
    Then the OGS app opens Trivia Jam's WebView at "https://triviajam.tv/"
    And the page gets Sam's OGS profile

  Scenario: Any path on a first-party game's domain
    Given Sam has the OGS app
    When Sam taps "https://triviajam.tv/host/new" in Mail
    Then the OGS app opens Trivia Jam's WebView at "https://triviajam.tv/host/new"

  Scenario: Routing comes from the catalogue
    Given a game whose startUrl is "https://example-game.example/" is in the catalogue
    And its domain is in the app's associated domains
    When a link to "https://example-game.example/r/ABCD" opens the app
    Then the app opens that game's WebView at "https://example-game.example/r/ABCD"

  Scenario: Without the app the link stays in the browser
    Given Sam does not have the OGS app
    When Sam taps "https://triviajam.tv/"
    Then Safari opens triviajam.tv

  Scenario: Typing the address stays in Safari and offers the app
    Given Sam has the OGS app
    When Sam types "triviajam.tv" into Safari
    Then Safari shows triviajam.tv
    And the page shows "Open in OGS", linking to "https://opengame.org/play/trivia-jam"

  Scenario: An outside developer's domain goes through the play link
    Given a game on a domain that is not in the app's associated domains
    When its page, outside OGS, shows "Play on TV with OGS"
    Then the link is "https://opengame.org/play/<appId>"
    And tapping it opens the OGS app on that game's page, with Play
    And on a phone that just installed OGS, onboarding comes first, then that game's page

  Scenario: The association files cover the whole site
    When "https://triviajam.tv/.well-known/apple-app-site-association" is fetched
    Then it lists appID "34S957HD77.org.opengame.app" for every path
    And "https://triviajam.tv/.well-known/assetlinks.json" names "org.opengame.app" with the release signing fingerprint
