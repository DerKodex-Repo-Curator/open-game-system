import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import {
  ApnsUploadSchema,
  apnsCredential,
  apnsSigningKey,
  credentialSummary,
  fcmCredential,
  pemBody,
  serviceAccountKey,
} from "../src/lib/push-credentials";
import type { AppDeviceRow } from "../src/lib/push-delivery";
import { pushSenders } from "../src/lib/push-senders";
import { boxKey, open, seal } from "../src/lib/secret-box";
import { scrub } from "../src/lib/wide-event";
import { openTestD1, type TestD1 } from "./support/d1";
import { fcmServiceAccount, p8Pem } from "./support/keys";

/**
 * The security of developers' push credentials (ADR 2026-10-18-multi-tenant-push;
 * docs/acceptance/2026-10-18-white-label-apps.feature, "Push credentials are secret"): sealed at rest
 * and bound to their app, readable and writable only with the app's own game key, and never in an
 * answer or a log line. Real local D1.
 */
const SECRET = "push-security-jwt-secret";
const PUSH_KEY_SECRET = "push-key-secret-for-tests-0123456789";
let d1: TestD1;
let rcKey: string;
let cbKey: string;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const rc = await generateApiKey();
  const cb = await generateApiKey();
  rcKey = rc.key;
  cbKey = cb.key;
  await d1.db.batch(
    [
      { id: "k-rc", appId: "rocket-crew", k: rc },
      { id: "k-cb", appId: "codebreakers", k: cb },
    ].map(({ id, appId, k }) =>
      d1.db
        .prepare(
          "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES (?, ?, ?, ?, 'notifications:send', 1)",
        )
        .bind(id, appId, k.prefix, k.hash),
    ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const env = (pushKeySecret = PUSH_KEY_SECRET) => ({
  DB: d1.db,
  OGS_JWT_SECRET: SECRET,
  PUSH_KEY_SECRET: pushKeySecret,
});
async function call(method: string, path: string, auth: string | null, body?: unknown) {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
  return { status: res.status, text: await res.text() };
}
/** The white-label sender (always there in the real senders). */
function nativeSender(e: ReturnType<typeof env>) {
  const native = pushSenders(e, Date.now()).native;
  if (!native) throw new Error("expected the native sender");
  return native;
}
const DEVICE: AppDeviceRow = {
  device_id: "d-1",
  platform: "ios",
  token: "ab".repeat(32),
  apns_environment: "sandbox",
};
const errorCode = (text: string) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(JSON.parse(text)).error.code;

/** The base64 body of a PEM: what must never leave the sealed column. */
const keyBody = (pem: string) => pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
/** Every 24-character window of the key body: a leak of any fragment of it is caught. */
const fragments = (pem: string) => {
  const body = keyBody(pem);
  return Array.from({ length: Math.floor(body.length / 24) }, (_, i) =>
    body.slice(i * 24, i * 24 + 24),
  );
};
const leaks = (text: string, pem: string) =>
  text.includes("PRIVATE KEY") || fragments(pem).some((f) => text.includes(f));

async function registerIos(appId: string, key: string, bundleId: string) {
  const res = await call("PUT", `/api/v1/apps/${appId}/native/ios`, key, {
    bundleId,
    teamId: "34S957HD77",
  });
  expect(res.status).toBe(201);
}
async function uploadP8(appId: string, key: string | null, p8: string) {
  return call("PUT", `/api/v1/apps/${appId}/push-credentials`, key, {
    ios: { p8, keyId: "ABC123DEFG", teamId: "34S957HD77" },
  });
}
const storedRow = (appId: string, platform: string) =>
  d1.db
    .prepare("SELECT * FROM app_push_credentials WHERE app_id = ? AND platform = ?")
    .bind(appId, platform)
    .first();

describe("the secret box: sealed values are bound to their secret and their owner", () => {
  it("opens what it sealed, for the same owner", async () => {
    const sealed = await seal("a key", PUSH_KEY_SECRET, "rocket-crew:ios");
    expect(await open(sealed, PUSH_KEY_SECRET, "rocket-crew:ios")).toBe("a key");
  });

  it("won't open a value sealed for another owner (a row copied between apps)", async () => {
    const sealed = await seal("a key", PUSH_KEY_SECRET, "rocket-crew:ios");
    await expect(open(sealed, PUSH_KEY_SECRET, "codebreakers:ios")).rejects.toThrow();
    await expect(open(sealed, PUSH_KEY_SECRET, "rocket-crew:android")).rejects.toThrow();
  });

  it("won't open with another secret, or once the ciphertext is changed", async () => {
    const sealed = await seal("a key", PUSH_KEY_SECRET, "rocket-crew:ios");
    await expect(open(sealed, "another-secret-0123456789", "rocket-crew:ios")).rejects.toThrow();
    const flipped = `${sealed.secretEnc.startsWith("A") ? "B" : "A"}${sealed.secretEnc.slice(1)}`;
    await expect(
      open({ ...sealed, secretEnc: flipped }, PUSH_KEY_SECRET, "rocket-crew:ios"),
    ).rejects.toThrow();
  });

  it("seals the same value differently every time (a fresh IV)", async () => {
    const a = await seal("a key", PUSH_KEY_SECRET, "rocket-crew:ios");
    const b = await seal("a key", PUSH_KEY_SECRET, "rocket-crew:ios");
    expect(a.iv).not.toBe(b.iv);
    expect(a.secretEnc).not.toBe(b.secretEnc);
  });
});

describe("at rest: the database holds only sealed keys", { timeout: 20_000 }, () => {
  it("an uploaded .p8 is nowhere in its row", async () => {
    const p8 = await p8Pem();
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    expect((await uploadP8("rocket-crew", rcKey, p8)).status).toBe(204);
    const row = await storedRow("rocket-crew", "ios");
    expect(row).not.toBeNull();
    expect(leaks(JSON.stringify(row), p8)).toBe(false);
    expect(await apnsCredential(d1.db, "rocket-crew", PUSH_KEY_SECRET)).toMatchObject({
      p8,
      keyId: "ABC123DEFG",
    });
  });

  it("an uploaded service account's private key is nowhere in its row", async () => {
    const sa = await fcmServiceAccount();
    const reg = await call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, {
      package: "tv.rocketcrew.app",
      sha256CertFingerprints: [Array.from({ length: 32 }, () => "AB").join(":")],
      googleClientIds: [],
    });
    expect(reg.status).toBe(201);
    const up = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      android: { serviceAccount: sa },
    });
    expect(up.status).toBe(204);
    const row = await storedRow("rocket-crew", "android");
    expect(leaks(JSON.stringify(row), sa.private_key)).toBe(false);
    expect(await fcmCredential(d1.db, "rocket-crew", PUSH_KEY_SECRET)).toMatchObject({
      private_key: sa.private_key,
    });
  });

  it("one app's sealed key copied into another app's row can't be opened or sent with", async () => {
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    await registerIos("codebreakers", cbKey, "tv.codebreakers.app");
    expect((await uploadP8("rocket-crew", rcKey, await p8Pem())).status).toBe(204);
    expect((await uploadP8("codebreakers", cbKey, await p8Pem())).status).toBe(204);
    const rc = z
      .object({ secret_enc: z.string(), iv: z.string() })
      .parse(await storedRow("rocket-crew", "ios"));
    await d1.db
      .prepare(
        "UPDATE app_push_credentials SET secret_enc = ?, iv = ? WHERE app_id = 'codebreakers' AND platform = 'ios'",
      )
      .bind(rc.secret_enc, rc.iv)
      .run();
    await expect(apnsCredential(d1.db, "codebreakers", PUSH_KEY_SECRET)).rejects.toThrow();

    const apple = vi.fn();
    vi.stubGlobal("fetch", apple);
    const result = await nativeSender(env())("codebreakers", DEVICE, { title: "t", body: "b" });
    expect(result).toEqual({
      success: false,
      deviceActive: true,
      error: "push_credentials_unreadable",
    });
    expect(apple).not.toHaveBeenCalled();
  });

  it("with another PUSH_KEY_SECRET the sender refuses quietly, without calling Apple", async () => {
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    expect((await uploadP8("rocket-crew", rcKey, await p8Pem())).status).toBe(204);
    const apple = vi.fn();
    vi.stubGlobal("fetch", apple);
    const result = await nativeSender(env("rotated-secret-0123456789"))("rocket-crew", DEVICE, {
      title: "t",
      body: "b",
    });
    expect(result).toEqual({
      success: false,
      deviceActive: true,
      error: "push_credentials_unreadable",
    });
    expect(apple).not.toHaveBeenCalled();
  });
});

describe("owner only: an app's credentials need that game's key", { timeout: 20_000 }, () => {
  it("another game's key can't upload them (403), and nothing is stored", async () => {
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    const res = await uploadP8("rocket-crew", cbKey, await p8Pem());
    expect(res.status).toBe(403);
    expect(errorCode(res.text)).toBe("wrong_game");
    expect(await storedRow("rocket-crew", "ios")).toBeNull();
  });

  it("no key can't upload them (401)", async () => {
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    expect((await uploadP8("rocket-crew", null, await p8Pem())).status).toBe(401);
    expect(await storedRow("rocket-crew", "ios")).toBeNull();
  });

  it("another game's key can't read what's configured (403); no key is 401", async () => {
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    await uploadP8("rocket-crew", rcKey, await p8Pem());
    const other = await call("GET", "/api/v1/apps/rocket-crew/push-credentials", cbKey);
    expect(other.status).toBe(403);
    expect(errorCode(other.text)).toBe("wrong_game");
    expect((await call("GET", "/api/v1/apps/rocket-crew/push-credentials", null)).status).toBe(401);
  });

  it("another game sees only its own (nothing configured), and its uploads don't touch this app's", async () => {
    const p8 = await p8Pem();
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    await registerIos("codebreakers", cbKey, "tv.codebreakers.app");
    await uploadP8("rocket-crew", rcKey, p8);
    const theirs = await call("GET", "/api/v1/apps/codebreakers/push-credentials", cbKey);
    expect(JSON.parse(theirs.text)).toMatchObject({ ios: { configured: false } });
    await uploadP8("codebreakers", cbKey, await p8Pem());
    expect(await apnsCredential(d1.db, "rocket-crew", PUSH_KEY_SECRET)).toMatchObject({ p8 });
  });

  it("the owner's own read shows ids only, never the key", async () => {
    const p8 = await p8Pem();
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    await uploadP8("rocket-crew", rcKey, p8);
    const mine = await call("GET", "/api/v1/apps/rocket-crew/push-credentials", rcKey);
    expect(mine.status).toBe(200);
    expect(JSON.parse(mine.text)).toEqual({
      ios: {
        configured: true,
        keyId: "ABC123DEFG",
        teamId: "34S957HD77",
        bundleId: "tv.rocketcrew.app",
      },
      android: { configured: false },
    });
    expect(leaks(mine.text, p8)).toBe(false);
    expect(mine.text).not.toContain("secret_enc");
  });
});

describe("no key material in answers or logs", { timeout: 20_000 }, () => {
  /** Every console line written while `run` runs (the wide events go to console.info / console.error). */
  async function logged(run: () => Promise<unknown>): Promise<string> {
    const lines: unknown[] = [];
    const levels: ("log" | "info" | "warn" | "error" | "debug")[] = [
      "log",
      "info",
      "warn",
      "error",
      "debug",
    ];
    for (const level of levels)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args);
      });
    await run();
    return JSON.stringify(lines);
  }

  it("a key that isn't a usable key is refused without echoing it", async () => {
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    const fake =
      "-----BEGIN PRIVATE KEY-----\nTOPSECRETNOTAKEYTOPSECRETNOTAKEY\n-----END PRIVATE KEY-----\n";
    const res = await uploadP8("rocket-crew", rcKey, fake);
    expect(res.status).toBe(400);
    expect(errorCode(res.text)).toBe("invalid_credentials");
    expect(res.text).not.toContain("TOPSECRET");
  });

  it("a body that fails validation is refused without echoing the key in it", async () => {
    const p8 = await p8Pem();
    await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
    const res = await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
      ios: { p8, keyId: "bad", teamId: "34S957HD77" },
    });
    expect(res.status).toBe(400);
    expect(errorCode(res.text)).toBe("invalid_body");
    expect(leaks(res.text, p8)).toBe(false);
  });

  it("uploading, a refused upload and reading back log neither the key nor the game key", async () => {
    const p8 = await p8Pem();
    const sa = await fcmServiceAccount();
    const lines = await logged(async () => {
      await registerIos("rocket-crew", rcKey, "tv.rocketcrew.app");
      await uploadP8("rocket-crew", rcKey, p8);
      await uploadP8("rocket-crew", rcKey, `${p8}garbage`.replace("BEGIN", "BEGIN BROKEN"));
      await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
        android: { serviceAccount: sa },
      });
      await call("GET", "/api/v1/apps/rocket-crew/push-credentials", rcKey);
    });
    expect(leaks(lines, p8)).toBe(false);
    expect(leaks(lines, sa.private_key)).toBe(false);
    expect(lines).not.toContain(rcKey);
  });

  it("scrub takes private keys and game keys out of any logged text", () => {
    const text = scrub(
      "failed with -----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG\nByqGSM49\n-----END PRIVATE KEY----- for ogsk_abcDEF123_-xyz here",
    );
    expect(text).toBe("failed with [private key] for ogsk_REDACTED here");
  });
});

describe("key handling: keys stay inside the Worker's crypto", { timeout: 20_000 }, () => {
  it("the sealing key and the imported signing keys can't be exported", async () => {
    expect((await boxKey(PUSH_KEY_SECRET)).extractable).toBe(false);
    expect((await apnsSigningKey(await p8Pem()))?.extractable).toBe(false);
    expect((await serviceAccountKey((await fcmServiceAccount()).private_key))?.extractable).toBe(
      false,
    );
  });

  it("text that isn't a key is null, never a half-read key", async () => {
    const notBase64 = "-----BEGIN PRIVATE KEY-----\n!!!not base64!!!\n-----END PRIVATE KEY-----";
    expect(pemBody(notBase64)).toBeNull();
    const notDer = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----";
    expect(await apnsSigningKey(notDer)).toBeNull();
    expect(await serviceAccountKey(notDer)).toBeNull();
    // An RSA key isn't an APNs key, and a P-256 key isn't a service account's.
    expect(await apnsSigningKey((await fcmServiceAccount()).private_key)).toBeNull();
    expect(await serviceAccountKey(await p8Pem())).toBeNull();
  });

  it("key and team ids are exactly 10 characters, nothing before or after", () => {
    const ok = { p8: "x", keyId: "ABC123DEFG", teamId: "34S957HD77" };
    expect(ApnsUploadSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { keyId: "ABC123DEFGx" },
      { keyId: "xABC123DEFG" },
      { teamId: "34S957HD77x" },
      { teamId: "x34S957HD77" },
    ])
      expect(ApnsUploadSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
  });

  it("an app with only an Android key says iOS isn't configured", async () => {
    const sa = await fcmServiceAccount();
    await call("PUT", "/api/v1/apps/rocket-crew/native/android", rcKey, {
      package: "tv.rocketcrew.app",
      sha256CertFingerprints: [Array.from({ length: 32 }, () => "AB").join(":")],
      googleClientIds: [],
    });
    expect(
      (
        await call("PUT", "/api/v1/apps/rocket-crew/push-credentials", rcKey, {
          android: { serviceAccount: sa },
        })
      ).status,
    ).toBe(204);
    expect(await credentialSummary(d1.db, "rocket-crew")).toEqual({
      ios: { configured: false },
      android: { configured: true, projectId: "rocket-crew-test", clientEmail: sa.client_email },
    });
  });
});
