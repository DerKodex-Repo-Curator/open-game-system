import { ClaimsSchema } from "@open-game-system/ogs-protocol";
import { describe, expect, it } from "vitest";
import { issueToken, readClaims } from "../src/lib/identity";
import { signJwt } from "../src/lib/jwt";

const SECRET = "unit-secret";
const NOW = 1_800_000_000_000;

describe("profile tokens", () => {
  it("issues a device token whose claims match ClaimsSchema and expire after the ttl", async () => {
    const token = await issueToken({ sub: "p1", did: "d1", kind: "phone" }, SECRET, {
      now: NOW,
      ttlSeconds: 60,
    });
    const claims = await readClaims(token, SECRET, NOW);
    expect(ClaimsSchema.parse(claims)).toEqual({
      sub: "p1",
      did: "d1",
      kind: "phone",
      exp: NOW / 1000 + 60,
    });
    expect(claims && "sid" in claims).toBe(false);
  });

  it("issues a launcher token naming its session", async () => {
    const token = await issueToken(
      { sub: "host", did: "l1", kind: "launcher", sid: "s1" },
      SECRET,
      {
        now: NOW,
        ttlSeconds: 60,
      },
    );
    expect(await readClaims(token, SECRET, NOW)).toEqual({
      sub: "host",
      did: "l1",
      kind: "launcher",
      sid: "s1",
      exp: NOW / 1000 + 60,
    });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await issueToken({ sub: "p1", did: "d1", kind: "phone" }, "other", {
      now: NOW,
      ttlSeconds: 60,
    });
    expect(await readClaims(token, SECRET, NOW)).toBeNull();
  });

  it("rejects an expired token (exp is exclusive)", async () => {
    const token = await issueToken({ sub: "p1", did: "d1", kind: "phone" }, SECRET, {
      now: NOW,
      ttlSeconds: 60,
    });
    expect(await readClaims(token, SECRET, NOW + 59_999)).not.toBeNull();
    expect(await readClaims(token, SECRET, NOW + 60_000)).toBeNull();
  });

  it("rejects a well-signed token whose claims aren't profile claims (an old household token)", async () => {
    const token = await signJwt(
      { hid: "h1", did: "d1", kind: "phone", exp: NOW / 1000 + 60 },
      SECRET,
    );
    expect(await readClaims(token, SECRET, NOW)).toBeNull();
  });

  it("rejects junk", async () => {
    expect(await readClaims("a.b", SECRET, NOW)).toBeNull();
    expect(await readClaims("x.y.z", SECRET, NOW)).toBeNull();
  });
});
