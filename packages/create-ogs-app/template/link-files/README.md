# Link files for __OGS_LINK_BASE__

With these two files on your domain, a link to your game (in a message, an email, a push) opens
**__OGS_APP_NAME__** when it is installed, and the web page when it isn't. Serve them on every domain in
`linkDomains` (app.config.ts):

| URL | File | Content-Type |
|---|---|---|
| `https://<domain>/.well-known/apple-app-site-association` | `.well-known/apple-app-site-association` | `application/json` |
| `https://<domain>/.well-known/assetlinks.json` | `.well-known/assetlinks.json` | `application/json` |

- Copy `.well-known/` into your web game's static folder (Vite: `public/.well-known/`). On
  Cloudflare Pages add a `_headers` rule so the extension-less file is JSON:

  ```
  /.well-known/apple-app-site-association
    Content-Type: application/json
  ```

- Both must answer `200` over HTTPS **with no redirect**.
- `assetlinks.json` needs your Android signing certificate's SHA-256: run `eas credentials`
  (Android → your build profile) after the first Android build, and replace
  `REPLACE-WITH-THE-SHA-256-FROM-eas-credentials`. If you publish on Google Play with Play App
  Signing, add the **app signing key** SHA-256 from the Play Console too. Until then Android opens
  links in the browser.
- The iOS file says every path (`/*`) opens the app. Narrow `components` if parts of your site
  (a blog, a store) should stay in Safari.
- `ogs doctor --domain <domain>` checks both files.

Without a domain of your own, `https://opengame.org/play/__OGS_APP_ID__/<path>` opens the app at
`<path>` of your game; OGS serves those link files for you once you run `ogs apps register`.
