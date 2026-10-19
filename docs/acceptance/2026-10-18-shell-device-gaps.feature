# Status: BUILT 2026-10-18 (branch claude/shell-app). What Rocket Crew's device e2e (Maestro, iOS simulator +
# Android emulator) found missing in the white-label shell: the cast button with no Chromecast, the browser-TV
# fallback, custom-scheme links, and installable packed tarballs.
# Tests: packages/shell/src/__tests__ (jest-expo: shell-links-scheme, runtime-config-scheme, cast-store-options,
# cast-picker, CastPickerSheet, single-cast-picker), packages/shell/plugin/src/__tests__/app-scheme.test.ts,
# packages/cast-kit-react/src/shell-cast.test.tsx, scripts/pack-check (packed-exports test),
# packages/create-ogs-app/test.

Feature: The shell's cast picker, browser TV, scheme links and packages work on a real device

  Background:
    Given the app "rocket-crew" on the OGS shell, whose phone page is "https://play.rocketcrew.tv/phone"

  Rule: Custom-scheme links open the game

    Scenario Outline: A scheme link opens that page of the game
      When the app opens "<link>"
      Then the WebView loads "<page>"

      Examples:
        | link                                     | page                                       |
        | rocket-crew://play/rocket-crew/join/ABCD | https://play.rocketcrew.tv/join/ABCD       |
        | rocket-crew://play/join/ABCD?t=1         | https://play.rocketcrew.tv/join/ABCD?t=1   |
        | rocket-crew://join/ABCD#seat             | https://play.rocketcrew.tv/join/ABCD#seat  |
        | rocket-crew://play.html                  | https://play.rocketcrew.tv/play.html       |

    Scenario: Another app's scheme and the dev client's links are ignored
      When the app opens "night-flight://join/ABCD" or "rocket-crew://expo-development-client/?url=x"
      Then the WebView stays where it is

    Scenario: The plugin gives the app a scheme
      Given an app config with no scheme
      When the shell plugin runs
      Then the app's scheme is "rocket-crew"
      But an app that sets its own scheme keeps it

  Rule: In the shell, the TV is always a target

    Scenario: The cast button shows with no Chromecast on the network
      Given no Chromecast is found
      Then the game's cast store says casting is available
      And cast-kit-react's CastButton renders with 0 devices

    Scenario: Inside the OGS app nothing changes
      Given the OGS app's cast store and no Chromecast
      Then casting is not available and the CastButton renders nothing

    Scenario: The game's cast button opens the shell's picker
      When the game shows the cast picker (SHOW_CAST_PICKER)
      Then the native sheet "castPicker" lists every Chromecast found and "Use a browser TV"
      And the Google Cast dialog is not opened

    Scenario: Picking a Chromecast casts the launcher with chrome none
      When the player picks "Living Room TV" in the picker
      Then the Chromecast loads the launcher with "chrome=none&app=rocket-crew"
      And the picker closes

    Scenario: A browser TV pairs by code and shows the game
      When the player taps "Use a browser TV"
      Then the sheet says to open "ogs-tv.pages.dev" on the TV and type the code it shows
      When the player types the TV's code and taps "Pair"
      Then the phone claims the screen and casts to it
      And the screen is sent the launcher token with app "rocket-crew"

    Scenario: A wrong code says so
      When the player types a code no TV shows
      Then the sheet says "No TV shows that code. Check the code on the TV." and stays open

  Rule: Packed tarballs install and bundle

    Scenario: Every path a shell dependency's package.json names is in its tarball
      When each workspace package the shell depends on is packed with pnpm pack
      Then main, types, react-native and every exports target is a file in the tarball

    Scenario: A generated app bundles with packed tarballs
      Given a fresh app from create-ogs-app at HEAD using packed shell tarballs
      When it runs "expo export --platform ios"
      Then the bundle is written
