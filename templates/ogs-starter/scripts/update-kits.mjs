// Fetch the latest OGS kits (profile-kit, cast-kit-core) into vendor/ and reinstall.
// Usage: pnpm kits:update
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = process.env.OGS_DOCS ?? "https://ogs-docs.pages.dev";
const KITS = {
  "profile-kit": "open-game-system-profile-kit-0.1.0.tgz",
  "cast-kit-core": "open-game-system-cast-kit-core-0.2.0.tgz",
};
for (const [kit, file] of Object.entries(KITS)) {
  const res = await fetch(`${BASE}/pkg/${kit}.tgz`);
  if (!res.ok) throw new Error(`${kit}: HTTP ${res.status}`);
  writeFileSync(
    new URL(`../vendor/${file}`, import.meta.url),
    Buffer.from(await res.arrayBuffer()),
  );
  console.log(`vendor/${file} updated`);
}
execSync("pnpm install --force", { stdio: "inherit" });
