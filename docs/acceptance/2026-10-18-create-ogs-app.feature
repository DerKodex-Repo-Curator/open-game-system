# Status: BUILT (branch claude/create-ogs-app, not published to npm).
# Design: docs/design-docs/white-label-shell.md (decisions 5, 6, 11, 13, 14). Package: packages/create-ogs-app.
# Tests: packages/create-ogs-app/src/*.test.ts (pure), test/generate.test.ts (generates into a temp dir),
# test/bin.test.ts (the built bin and the packed tarball). Docs: apps/docs/content/ship-your-own-app.md.

Feature: A developer makes their game's own app with create-ogs-app

  Scenario: An agent makes Rocket Crew's app with flags
    When the developer runs "pnpm create ogs-app app --app-id rocket-crew --game-url https://rocketcrew.tv/phone --team-id 34S957HD77 --yes"
    Then app/ is an Expo app (SDK 55, the OGS app's exact versions) depending on @open-game-system/shell
    And app.config.ts sets bundle id and package "tv.rocketcrew.app" and team "34S957HD77" (the plugin never sets them)
    And it configures the shell plugin with appId "rocket-crew", name "Rocket Crew", the game URL, branding "hidden" and link domain "rocketcrew.tv"
    And app/index.tsx renders <OgsShell />
    And no __OGS_ placeholder is left in any file
    And it prints the next steps: install, run, ogs login, ogs apps register, ogs push credentials, eas build, eas submit, ogs doctor

  Scenario: Questions for what isn't given
    When the developer runs "pnpm create ogs-app" without flags
    Then it asks for each answer, offering a default where there is one (name from the app id, bundle id from the game's domain, package from the bundle id, the game's host as link domain, hidden branding)
    And a wrong answer is asked again with the reason
    And answers piped on stdin work the same; input that ends early is an error, not a hang

  Scenario: --yes without everything it needs
    When the developer runs "pnpm create ogs-app --yes --app-id rocket-crew"
    Then it writes nothing, exits 2 and names --game-url and --team-id

  Scenario: Shared hosts get no defaults from the domain
    When the game URL is on pages.dev, workers.dev, vercel.app, github.io or another shared host
    Then there is no default bundle id or link domain

  Scenario: No link domain of its own
    When the developer passes --no-link-domain
    Then linkDomains is empty, there are no link files, and links go through opengame.org/play/rocket-crew

  Scenario: Link files for the developer's domain
    When the app has link domain "rocketcrew.tv"
    Then link-files/.well-known/apple-app-site-association names "34S957HD77.tv.rocketcrew.app"
    And link-files/.well-known/assetlinks.json names package "tv.rocketcrew.app"

  Scenario: Ready for App Review and TestFlight
    Then REVIEW_NOTES.md walks a reviewer through native cast, native push, native sign-in, haptics and the offline screen, how to test them, and what the WebView loads
    And eas.json has development, preview (store builds for TestFlight and Play internal testing) and production, and no secrets

  Scenario: Never over someone's work
    Given app/ has files in it
    When the developer runs create-ogs-app into app/
    Then it exits 1, says the directory is not empty, and changes nothing

  Scenario: The game side
    Then examples/ has a cast button (cast-kit-react, only in the game's own app), the profile (profile-kit, guest and signed in alike, a name form in a browser) and a push link (notification-kit-server)
    And they type-check against those packages in the monorepo
