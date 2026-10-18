import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from "../src/lib/api-keys";

/** Per-game API keys: shown once, stored as a SHA-256 hash with a short display prefix. */
describe("game API keys", () => {
  it("starts with ogsk_ and carries 32 random bytes", async () => {
    const { key } = await generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toMatch(/^ogsk_[A-Za-z0-9_-]{43}$/);
  });

  it("is different every time", async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });

  it("stores a hash, not the key, and a 12-character prefix for display", async () => {
    const { key, hash, prefix } = await generateApiKey();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key.slice(5));
    expect(prefix).toBe(key.slice(0, 12));
    expect(await hashApiKey(key)).toBe(hash);
  });

  it("hashes deterministically (SHA-256 hex)", async () => {
    expect(await hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
