# Status: BUILT on claude/shell-platform (API preview opengame-api-pr-shell); opengame.org functions not deployed.
# Design: docs/design-docs/white-label-shell.md. ADR: docs/adrs/2026-10-18-multi-tenant-push.md.
# The platform half: apps are registered, their push credentials stored, pushes sent with the right
# app's credentials, and opengame.org's link files list every registered app.

Feature: A game ships as its own app, and OGS hosts its push and links

  Background:
    Given "rocket-crew" is in the catalogue
    And Rocket Crew's server holds an API key for "rocket-crew"

  # --- Registering the app ---

  Scenario: Registering the iOS app
    When the developer registers bundle id "tv.rocketcrew.app" with team "34S957HD77" for "rocket-crew" with Rocket Crew's API key
    Then the API answers 201 with the app's appId, platform "ios", bundle id and team id
    And registering the same bundle id again for "rocket-crew" updates it (200)

  Scenario: Registering the Android app with its signing certificate and sign-in client
    When the developer registers package "tv.rocketcrew.app" with SHA-256 fingerprint "AB:CD:…" and Google client id "123-abc.apps.googleusercontent.com" for "rocket-crew"
    Then the API answers 201 with platform "android"

  Scenario: Only the game's key can register its app
    When someone registers bundle id "tv.rocketcrew.app" for "rocket-crew" with Codebreakers' API key
    Then the API answers 403 "wrong_game"
    And without any key it answers 401

  Scenario: A bundle id belongs to one game
    Given bundle id "tv.rocketcrew.app" is registered for "rocket-crew"
    When Codebreakers registers bundle id "tv.rocketcrew.app" with its own key
    Then the API answers 409 "app_id_taken"

  Scenario: Bad registrations are refused
    When the developer registers bundle id "not a bundle id" or team id "ABC" or a fingerprint that isn't 32 hex pairs
    Then the API answers 400 "invalid_body" and nothing is stored

  # --- Push credentials ---

  Scenario: Uploading the APNs key
    Given bundle id "tv.rocketcrew.app" is registered for "rocket-crew"
    When the developer uploads the .p8 key with key id "ABC123DEFG" and team id "34S957HD77"
    Then the API answers 204
    And the stored key is encrypted (the .p8 text is nowhere in D1)
    And GET push-credentials says ios is configured with key id "ABC123DEFG" and never returns the key

  Scenario: Uploading the FCM service account
    Given package "tv.rocketcrew.app" is registered for "rocket-crew"
    When the developer uploads the service account JSON
    Then the API answers 204 and GET says android is configured for project id and client email (no private key)

  Scenario: Credentials for an app that isn't registered
    When the developer uploads an APNs key for "rocket-crew" before registering an iOS app
    Then the API answers 409 "app_not_registered"

  Scenario: A key that isn't a key
    When the .p8 isn't a PEM PKCS#8 EC P-256 private key, or the service account has no private_key
    Then the API answers 400 "invalid_credentials" and nothing is stored

  # --- Devices and sending ---

  Scenario: The shell registers its device for the app
    Given Sam's phone runs Rocket Crew's app (bundle "tv.rocketcrew.app") signed in as Sam
    When the shell registers its APNs token for "rocket-crew" (environment "production")
    Then the device is stored for "rocket-crew" with token kind "apns"

  Scenario: A game's push reaches its own app with its own key
    Given Sam granted Rocket Crew pushes and has a handle
    And Sam's phone runs Rocket Crew's app with an APNs token, and Rocket Crew's APNs key is uploaded
    When Rocket Crew's server sends a push to Sam's handle
    Then OGS posts it to APNs with apns-topic "tv.rocketcrew.app", signed with Rocket Crew's key id and team id
    And the result for the handle is "sent"

  Scenario: Android, through FCM v1 with the app's service account
    Given Sam's Android phone runs Rocket Crew's app with an FCM token, and the service account is uploaded
    When Rocket Crew's server sends a push to Sam's handle
    Then OGS posts it to FCM v1 for the service account's project with an OAuth token from that account

  Scenario: Another game's push never reaches Rocket Crew's app
    Given Sam's phone runs Rocket Crew's app and Sam granted Codebreakers pushes too
    When Codebreakers sends Sam a push
    Then nothing is sent to Rocket Crew's app's token

  Scenario: The OGS app still gets pushes as before
    Given Sam also has the OGS app (an Expo token)
    When Rocket Crew sends Sam a push
    Then the OGS app's phone gets it through Expo, as today, and the send API is unchanged

  Scenario: A token the push service says is gone
    When APNs answers 410 (or FCM UNREGISTERED) for Sam's Rocket Crew device
    Then that app device is removed and the handle's result is not "sent" from it

  Scenario: An app without credentials
    Given Rocket Crew's iOS app is registered but no APNs key is uploaded
    When Rocket Crew sends Sam a push and Sam has only the Rocket Crew app
    Then nothing is sent to it and the result is "failed"

  # --- Links ---

  Scenario: opengame.org's link files list every registered app first
    Given Rocket Crew's iOS and Android apps are registered
    When a phone fetches opengame.org/.well-known/apple-app-site-association
    Then the first detail is appID "34S957HD77.tv.rocketcrew.app" with paths "/play/rocket-crew" and "/play/rocket-crew/*"
    And the OGS app's entry ("34S957HD77.org.opengame.app": /open, /open/*, /play/*, /join/*) comes after it
    And assetlinks.json lists "tv.rocketcrew.app" with its fingerprints as well as "org.opengame.app"
