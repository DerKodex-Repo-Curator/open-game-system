# Status: BUILT on claude/shell-platform (packages/cli; not published).
# Design: docs/design-docs/white-label-shell.md (decision 15). Package @open-game-system/cli, bin `ogs`.

Feature: The ogs CLI sets up a game's white-label app

  Scenario: Logging in with the game's API key
    When the developer runs "ogs login --app rocket-crew --key <the game's API key>"
    Then the CLI checks it against the API and saves it to ~/.config/ogs/credentials.json (mode 0600)
    And a wrong key is refused without saving

  Scenario: Registering the apps
    When the developer runs "ogs apps register --ios tv.rocketcrew.app --team-id 34S957HD77"
    And "ogs apps register --android tv.rocketcrew.app --sha256 AB:CD:… --google-client-id 123-abc.apps.googleusercontent.com"
    Then both are registered for "rocket-crew"

  Scenario: Uploading push credentials
    When the developer runs "ogs push credentials --ios AuthKey_ABC123DEFG.p8 --key-id ABC123DEFG --team-id 34S957HD77"
    And "ogs push credentials --android service-account.json"
    Then the files are uploaded and the CLI prints what is configured, never the key

  Scenario: Doctor checks what it can
    When the developer runs "ogs doctor"
    Then it reports, for each registered app: registered, push credentials present,
      the app listed in opengame.org's apple-app-site-association / assetlinks.json for /play/<appId>,
      the developer's own domain's files (if --domain is given), and the game's manifest tvUrl reachable
    And it exits non-zero when a check fails, saying what to do

  Scenario: The API base can point at a preview
    When OGS_API is set to a preview API
    Then every command uses it
