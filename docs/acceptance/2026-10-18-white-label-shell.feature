# Status: PLANNED 2026-10-18 (branch claude/shell-app). Design: docs/design-docs/white-label-shell.md;
# plan: docs/exec-plans/active/white-label-shell.md. Extraction steps 0–6 build the package and its config
# plugin; the single-game runtime (links, offline screen, guest profile, native sign-in, haptics, cast
# chrome "none") follows in steps 7–13.
# Tests: packages/shell/plugin/src/__tests__ (Vitest), packages/shell/src/__tests__ (jest-expo),
# apps/mobile/services/__tests__/shell-resolution.test.ts (one copy of every mocked native module).

Feature: A game ships as its own app on the OGS shell

  Background:
    Given a game "rocket-crew" whose phone page is "https://rocketcrew.tv/play"

  Rule: The shell config is parsed at the boundary

    Scenario: A minimal config gets its defaults
      When the developer configures the shell with appId "rocket-crew", gameUrl "https://rocketcrew.tv/play" and name "Rocket Crew"
      Then branding is "hidden", linkDomains is empty and the cast receiver is "ogs"

    Scenario: The game page must be HTTPS
      When the developer configures gameUrl "http://rocketcrew.tv/play"
      Then the config is rejected with a message naming gameUrl

    Scenario: An app id must be a catalogue id
      When the developer configures appId "Rocket Crew!"
      Then the config is rejected with a message naming appId

  Rule: The plugin writes the native config the shell needs, and nothing that is the developer's

    Scenario: Links open the app on the developer's domain and on opengame.org
      Given linkDomains "rocketcrew.tv"
      Then iOS associated domains are "applinks:rocketcrew.tv" and "applinks:opengame.org"
      And Android has auto-verified VIEW intent filters for "https://rocketcrew.tv/" and "https://opengame.org/play/rocket-crew"

    Scenario: Casting finds Chromecasts on the local network
      Then the iOS Info.plist names the app in NSLocalNetworkUsageDescription
      And NSBonjourServices includes "_googlecast._tcp"
      And react-native-google-cast is configured with the OGS receiver "807AD5E9"

    Scenario: Sign in with Apple and push are enabled
      Then iOS usesAppleSignIn is true
      And the expo-notifications, expo-apple-authentication and expo-splash-screen plugins are applied

    Scenario: The runtime reads its config from the app manifest
      Then extra.ogsShell has the appId, gameUrl, branding and linkDomains

    Scenario: The developer's identity is never written
      Then the bundle identifier, Android package, Apple team and Expo owner are left as the developer set them

    Scenario: Running the plugin twice changes nothing more
      Given an app config that already lists "applinks:opengame.org" and the react-native-google-cast plugin
      When the plugin runs twice
      Then every associated domain, Bonjour service, intent filter and plugin appears once

  Rule: The OGS app is the shell's first consumer and keeps working unchanged

    Scenario: Moved modules are the same modules
      Given a module moved from apps/mobile/services to the shell
      Then apps/mobile/services keeps a one-line re-export of it
      And every existing apps/mobile test passes without being edited

    Scenario: Mocked native modules have one copy
      Then each native module the shell imports resolves to the same real path from the shell's source and from apps/mobile
      And the shell's dev dependency on it uses apps/mobile's exact version range

    Scenario: The OGS app's native build does not change
      When apps/mobile depends on the shell
      Then the apps/mobile native fingerprint is unchanged
