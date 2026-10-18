#!/usr/bin/env node
// Issues a game's API key (docs/product-specs/push-notifications.md, "Keys"): prints the key ONCE on
// stdout and stores only its SHA-256 hash in D1. Mirrors src/lib/api-keys.ts.
//
//   pnpm --filter @open-game-system/api issue-key <appId>            local D1 (wrangler --local)
//   pnpm --filter @open-game-system/api issue-key <appId> --remote   production D1
//   ... issue-key <appId> --dry   prints {"key","sql"} and touches nothing (tests)
//
// Pipe it straight into the game's secret so it never lands in a terminal or transcript:
//   pnpm -s --filter @open-game-system/api issue-key night-flight --remote | (cd ~/src/night-flight-owls && wrangler secret put OGS_API_KEY)
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const appId = args.find((a) => !a.startsWith("--"));
if (!appId || !/^[a-z0-9-]+$/.test(appId)) {
  console.error("usage: issue-key <appId> [--remote | --dry]");
  process.exit(2);
}

const key = `ogsk_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");
const sql =
  "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES " +
  `('${randomUUID()}', '${appId}', '${key.slice(0, 12)}', '${hash}', 'notifications:send', ${Date.now()})`;

if (args.includes("--dry")) {
  process.stdout.write(JSON.stringify({ key, sql }));
  process.exit(0);
}

execFileSync(
  "wrangler",
  [
    "d1",
    "execute",
    "opengame-api-db",
    args.includes("--remote") ? "--remote" : "--local",
    "--command",
    sql,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
console.error(`Issued a key for ${appId} (${key.slice(0, 12)}…). It is shown once, on stdout.`);
process.stdout.write(key);
