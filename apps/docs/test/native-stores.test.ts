/**
 * The bridge stores a game can use in a native app (haptics, account) are documented from their
 * ogs-protocol schemas on the Messages page and in the contract.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSite } from "../src/build";
import { SPEC_FILE } from "../src/paths";
import { allSchemaRows } from "../src/schemas";

const out = mkdtempSync(join(tmpdir(), "ogs-docs-native-"));
buildSite(out);
const messages = readFileSync(resolve(out, "messages.md"), "utf8");

describe("native app bridge stores in the docs", () => {
  it("the Messages page lists the haptics and account stores", () => {
    expect(messages).toMatch(/\| `haptics` \| page → app \|/);
    expect(messages).toMatch(/\| `account` \| both \|/);
  });

  it("generates the haptics events from HapticsBridgeEventSchema", () => {
    expect(messages).toContain("### `IMPACT`");
    expect(messages).toContain("### `NOTIFY`");
    expect(messages).toMatch(/\| `style` \| "light" \\\| "medium" \\\| "heavy" \| yes \|/);
    expect(messages).toMatch(/\| `kind` \| "success" \\\| "warning" \\\| "error" \| yes \|/);
  });

  it("generates the account store from its schemas", () => {
    expect(messages).toContain("### `SIGN_IN`");
    expect(messages).toMatch(
      /\| `login` \| "none" \\\| "guest" \\\| "apple" \\\| "google" \| yes \|/,
    );
    expect(messages).toMatch(/\| `signingIn` \| boolean \| yes \|/);
  });

  it("describes every new row", () => {
    const rows = allSchemaRows().map((r) => r.field);
    for (const f of ["`style`", "`kind`", "`login`", "`signingIn`"]) expect(rows).toContain(f);
  });

  it("the contract names both stores", () => {
    const spec = readFileSync(SPEC_FILE, "utf8");
    expect(spec).toContain("HapticsBridgeEventSchema");
    expect(spec).toContain("AccountBridgeEventSchema");
  });
});
