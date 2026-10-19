# Status: SHIPPED 2026-10-19 (main d2897aca: API + schema by CI; opengame.org, ogs-tv, ogs-docs deployed); the CLI isn't on npm yet (CI's NPM_TOKEN can't publish to @open-game-system: E404).
# ADR: docs/adrs/2026-10-18-ogs-developer-api.md. The shell commands are in 2026-10-18-ogs-cli.feature.

Feature: ogs is the OGS developer tool

  # --- manifest check / publish (catalogue) ---

  Scenario: A valid manifest passes, locally and on the API
    Given ogs.manifest.json is a valid manifest whose startUrl answers 200 and whose tvUrl can be framed
    When the developer runs "ogs manifest check"
    Then it prints "valid" with no issues and exits 0

  Scenario: Schema issues and catalogue warnings are named
    Given a manifest with no roles for a kid, no art kit, and an http startUrl
    When the developer runs "ogs manifest check"
    Then it lists warnings no_kid_role, missing_art and start_url_not_https
    And a manifest missing startUrl lists the issue at path "startUrl" and exits 1

  Scenario: Publishing submits the entry for review
    When the developer runs "ogs publish"
    Then the API stores a pending entry and the CLI prints "pending review"
    And "ogs publish --status" prints the entry's status

  Scenario: An approved entry is in the catalogue
    Given a pending entry for "comet-catch"
    When an admin approves it
    Then GET /api/v1/catalogue includes "comet-catch"
    And a rejected entry stays out, with the admin's note in its status

  Scenario: Only the game's key publishes its entry
    When someone publishes "rocket-crew" with Codebreakers' key
    Then the API answers 403 wrong_game

  # --- init ---

  Scenario: Adding OGS to an existing web game
    Given a Vite game repo with no OGS
    When the developer runs "ogs init --app-id comet-catch --name 'Comet Catch' --start-url https://comet.example/"
    Then ogs.manifest.json is written and valid
    And the kits from GET /api/v1/dev/kits are in vendor/ and in package.json
    And OGS.md has the checklist for this repo with the agent prompt and the llms.txt link
    And "ogs init --dry" changes nothing and prints the plan

  # --- dev ---

  Scenario: Running the game with no device
    Given a game with ogs.manifest.json
    When the developer runs "ogs dev"
    Then localhost:4747 shows the TV page framed with ogs:start and a fake couch, a phone frame with a fake app bridge, and a QR code of the start URL on the LAN
    And the game's server verifies the fake game token against localhost:4747/.well-known/jwks.json

  # --- try / push send (deliver) ---

  Scenario: Deploying and registering a try path
    Given a game with try-kit and a deploy:try script
    When the developer runs "ogs try"
    Then the try Worker is deployed, OGS checks its / and /ws-probe, and stores the URL
    And GET /api/v1/catalogue gives the game a tryUrl

  Scenario: A URL that isn't a try path
    When the developer runs "ogs try --url https://example.com --check-only"
    Then the API answers 422 try_path_not_found saying which check failed

  Scenario: A test push to your own handle
    Given the developer's handle for the game
    When they run "ogs push send --to <handle> --title 'Test' --url https://comet.example/room/ABCD"
    Then the CLI prints the handle's status ("sent")
    And "ogs push send --to <handle> --check" lists the handle's surfaces without sending
