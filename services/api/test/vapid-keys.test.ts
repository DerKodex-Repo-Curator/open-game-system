import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { vapidKeysFor } from "../src/lib/vapid-keys";
import { openTestD1, type TestD1 } from "./support/d1";

/** Per-game VAPID keys (spec §9): made on first use, private half encrypted under PUSH_KEY_SECRET. */
let d1: TestD1;
beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(() => d1.reset());

const SECRET = "push-key-secret-for-tests";
const b64urlToBytes = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

describe("a game's VAPID keys", () => {
  it("are made on first use: a 65-byte uncompressed P-256 public key and a 32-byte private key", async () => {
    const keys = await vapidKeysFor(d1.db, "codebreakers", SECRET, 1);
    if (!keys) throw new Error("no keys");
    const pub = b64urlToBytes(keys.publicKey);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(4);
    expect(b64urlToBytes(keys.privateKey).length).toBe(32);
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("are the same on every later use, and different per game", async () => {
    const a = await vapidKeysFor(d1.db, "codebreakers", SECRET, 1);
    const b = await vapidKeysFor(d1.db, "codebreakers", SECRET, 2);
    const c = await vapidKeysFor(d1.db, "rocket-crew", SECRET, 3);
    expect(b).toEqual(a);
    expect(c?.publicKey).not.toBe(a?.publicKey);
  });

  it("store the private key encrypted, never in the clear", async () => {
    const keys = await vapidKeysFor(d1.db, "codebreakers", SECRET, 1);
    const row = await d1.db
      .prepare("SELECT * FROM push_vapid_keys WHERE app_id = 'codebreakers'")
      .first();
    expect(JSON.stringify(row)).not.toContain(keys?.privateKey);
    expect(row).toMatchObject({
      app_id: "codebreakers",
      public_key: keys?.publicKey,
      created_at: 1,
    });
  });

  it("can't be read with another secret", async () => {
    await vapidKeysFor(d1.db, "codebreakers", SECRET, 1);
    await expect(vapidKeysFor(d1.db, "codebreakers", "another-secret", 2)).rejects.toThrow();
  });

  it("are unavailable without a secret", async () => {
    expect(await vapidKeysFor(d1.db, "codebreakers", undefined, 1)).toBeNull();
    expect(await vapidKeysFor(d1.db, "codebreakers", "", 1)).toBeNull();
    expect(await d1.db.prepare("SELECT COUNT(*) AS n FROM push_vapid_keys").first("n")).toBe(0);
  });
});
