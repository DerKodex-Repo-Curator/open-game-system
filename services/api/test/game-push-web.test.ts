import { createECDH } from "node:crypto";
// @ts-expect-error http_ece ships no types (test-only reference decoder)
import ece from "http_ece";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * Web push opt-in (docs/acceptance/2026-10-07-game-push.feature, "Opting in from the game's PWA"):
 * the game's PWA fetches its VAPID public key and posts its subscription from the game's own origin.
 */
let d1: TestD1;
beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(() => d1.reset());

const ORIGIN = "https://codebreakers.jonathanrmumm.workers.dev";
const env = (over: Record<string, unknown> = {}) => ({
  DB: d1.db,
  OGS_JWT_SECRET: "s",
  PUSH_KEY_SECRET: "push-secret",
  ...over,
});
const sub = (endpoint = "https://push.example.net/send/1") => ({
  endpoint,
  keys: { p256dh: "BPk-p256dh", auth: "au-th" },
});

async function call(
  method: string,
  path: string,
  opts: { origin?: string; body?: unknown; env?: Record<string, unknown> } = {},
) {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.origin ? { Origin: opts.origin } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    env(opts.env),
  );
  return { status: res.status, body: z.record(z.string(), z.unknown()).parse(await res.json()) };
}
const subscribe = (body: unknown, origin = ORIGIN) =>
  call("POST", "/api/v1/games/codebreakers/push-subscriptions", { origin, body });
const handleOf = async (body: unknown) => z.string().parse((await subscribe(body)).body.handle);

describe("GET /games/:appId/push-key", () => {
  it("answers the game's VAPID public key, the same every time", async () => {
    const a = await call("GET", "/api/v1/games/codebreakers/push-key");
    const b = await call("GET", "/api/v1/games/codebreakers/push-key");
    expect(a.status).toBe(200);
    expect(a.body.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(b.body).toEqual(a.body);
  });

  it("404 for a game outside the catalogue", async () => {
    expect((await call("GET", "/api/v1/games/ghost/push-key")).status).toBe(404);
  });

  it("503 when web push isn't configured (no PUSH_KEY_SECRET)", async () => {
    const res = await call("GET", "/api/v1/games/codebreakers/push-key", {
      env: { PUSH_KEY_SECRET: undefined },
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: "web_push_unavailable",
      message: "Web push is not configured",
      status: 503,
    });
  });
});

describe("POST /games/:appId/push-subscriptions", () => {
  it("from the game's origin: granted, a handle, a web surface with the subscription", async () => {
    const res = await subscribe({ subscription: sub() });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("granted");
    const handle = z.string().parse(res.body.handle);
    expect(handle).toMatch(/^ph_/);
    const row = await d1.db
      .prepare(
        "SELECT kind, endpoint, p256dh, auth, profile_id FROM push_surfaces WHERE handle_id = ?",
      )
      .bind(handle)
      .first();
    expect(row).toEqual({
      kind: "web",
      endpoint: "https://push.example.net/send/1",
      p256dh: "BPk-p256dh",
      auth: "au-th",
      profile_id: null,
    });
  });

  it("refuses another origin, or none, and stores nothing", async () => {
    for (const origin of [
      "https://elsewhere.example",
      "http://codebreakers.jonathanrmumm.workers.dev",
      "",
    ]) {
      const res = await subscribe({ subscription: sub() }, origin);
      expect(res.status, origin).toBe(403);
      expect(res.body.error).toEqual({
        code: "wrong_origin",
        message: "Subscriptions come from the game's own site",
        status: 403,
      });
    }
    expect(await d1.db.prepare("SELECT COUNT(*) AS n FROM push_surfaces").first("n")).toBe(0);
  });

  it("the same subscription again keeps its handle and becomes the most recent", async () => {
    const h = await handleOf({ subscription: sub() });
    await d1.db.prepare("UPDATE push_surfaces SET last_active_at = 1").run();
    expect(await handleOf({ subscription: sub() })).toBe(h);
    const at = await d1.db
      .prepare("SELECT last_active_at AS t FROM push_surfaces WHERE handle_id = ?")
      .bind(h)
      .first("t");
    expect(Number(at)).toBeGreaterThan(1);
    expect(await d1.db.prepare("SELECT COUNT(*) AS n FROM push_surfaces").first("n")).toBe(1);
  });

  it("joins a handle the page already holds (from the OGS app), and moves the subscription to it", async () => {
    const appHandle = "ph_fromtheapp00000001";
    await d1.db
      .prepare("INSERT INTO push_handles (id, app_id, created_at) VALUES (?, 'codebreakers', 1)")
      .bind(appHandle)
      .run();
    const old = await handleOf({ subscription: sub() });
    expect(await handleOf({ subscription: sub(), handle: appHandle })).toBe(appHandle);
    const owners = await d1.db
      .prepare("SELECT handle_id FROM push_surfaces WHERE endpoint = ?")
      .bind(sub().endpoint)
      .all();
    expect(owners.results).toEqual([{ handle_id: appHandle }]);
    expect(old).not.toBe(appHandle);
  });

  it("a handle of another game is not joined", async () => {
    const other = "ph_rocketcrewhandle01";
    await d1.db
      .prepare("INSERT INTO push_handles (id, app_id, created_at) VALUES (?, 'rocket-crew', 1)")
      .bind(other)
      .run();
    expect(await handleOf({ subscription: sub(), handle: other })).not.toBe(other);
  });

  it("rejects a subscription that isn't one", async () => {
    for (const body of [
      {},
      { subscription: { endpoint: "http://push.example.net/x", keys: { p256dh: "a", auth: "b" } } },
      { subscription: sub(), handle: "nope" },
    ]) {
      const res = await subscribe(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: "invalid_body" });
    }
  });

  it("404 for a game outside the catalogue", async () => {
    expect(
      (
        await call("POST", "/api/v1/games/ghost/push-subscriptions", {
          origin: ORIGIN,
          body: { subscription: sub() },
        })
      ).status,
    ).toBe(404);
  });
});

describe("one call, delivered to the PWA", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the game server sends to a web-only handle; the push service gets a body the browser can decrypt", async () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
    const subscription = {
      endpoint: "https://push.example.net/send/alex",
      keys: { p256dh: Buffer.from(ecdh.getPublicKey()).toString("base64url"), auth },
    };
    const handle = await handleOf({ subscription });
    const key = await generateApiKey();
    await d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k', 'codebreakers', ?, ?, 'notifications:send', 1)",
      )
      .bind(key.prefix, key.hash)
      .run();
    const delivered: Buffer[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url !== subscription.endpoint) throw new Error(`unexpected fetch ${url}`);
      delivered.push(Buffer.from(init.body as Uint8Array));
      return new Response(null, { status: 201 });
    });
    const res = await app.request(
      "/api/v1/games/codebreakers/notifications",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [handle],
          title: "Clue: RIVER 2",
          body: "Sam gave Moon a clue.",
          tag: "cb-KQTP",
        }),
      },
      env(),
    );
    expect(await res.json()).toEqual({ results: [{ to: handle, status: "sent" }] });
    const plain = ece.decrypt(delivered[0], {
      version: "aes128gcm",
      privateKey: ecdh,
      authSecret: auth,
    });
    expect(JSON.parse(plain.toString("utf8"))).toEqual({
      title: "Clue: RIVER 2",
      body: "Sam gave Moon a clue.",
      url: "https://codebreakers.jonathanrmumm.workers.dev/",
      whenOpen: "deliver",
      tag: "cb-KQTP",
    });
  });

  it("without PUSH_KEY_SECRET a web surface fails (and is kept)", async () => {
    const handle = await handleOf({ subscription: sub() });
    const key = await generateApiKey();
    await d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k', 'codebreakers', ?, ?, 'notifications:send', 1)",
      )
      .bind(key.prefix, key.hash)
      .run();
    const res = await app.request(
      "/api/v1/games/codebreakers/notifications",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: [handle], title: "t", body: "b" }),
      },
      env({ PUSH_KEY_SECRET: undefined }),
    );
    expect(await res.json()).toEqual({ results: [{ to: handle, status: "failed" }] });
    expect(await d1.db.prepare("SELECT COUNT(*) AS n FROM push_surfaces").first("n")).toBe(1);
  });
});
