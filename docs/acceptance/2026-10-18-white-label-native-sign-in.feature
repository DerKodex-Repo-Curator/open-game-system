# Status: SHIPPED 2026-10-19 (main d2897aca: API + schema by CI; opengame.org, ogs-tv, ogs-docs deployed).
# Design: docs/design-docs/white-label-shell.md (decision 8: guest first, native upgrade).
# POST /api/v1/auth/native { provider, identityToken, deviceProfileId?, device? }.

Feature: A white-label app signs a guest in with Apple or Google

  Background:
    Given Rocket Crew's iOS app "tv.rocketcrew.app" and its Android app with Google client id "123-abc.apps.googleusercontent.com" are registered

  Scenario: A guest backs up with Sign in with Apple
    Given Ada's phone runs Rocket Crew's app as a guest profile with a device token
    When the shell posts Ada's Apple identity token (audience "tv.rocketcrew.app") with that guest's token and deviceProfileId
    Then the guest profile is now backed up by that Apple login
    And the answer has the same profile and a device token

  Scenario: A guest signs in to an account that already exists
    Given Ada's Apple login already backs up her OGS profile from the OGS app
    And a new phone runs Rocket Crew's app as a fresh guest
    When the shell posts Ada's Apple identity token with the guest's token
    Then the phone's device moves to Ada's profile and the answer has Ada's profile and a device token for it

  Scenario: Google on Android
    When the shell posts a Google identity token whose audience is "123-abc.apps.googleusercontent.com"
    Then it is accepted like an Apple one

  Scenario: Tokens for apps that aren't registered are refused
    When the shell posts an Apple identity token whose audience is "com.example.unknown"
    Then the API answers 401 "invalid_id_token"

  Scenario: The guest must be proven
    When the shell posts a deviceProfileId without that profile's token (or with another profile's)
    Then the API answers 403 "not_your_profile"

  Scenario: The OGS app's own sign-in is unchanged
    When the OGS app posts to /api/v1/auth/apple with audience "org.opengame.app"
    Then it works as before
