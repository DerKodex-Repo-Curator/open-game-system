import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { base64url } from "../src/lib/base64url";
import { DEFAULT_VAPID_SUBJECT, pushSenders } from "../src/lib/push-senders";
import { vapidKeysFor } from "../src/lib/vapid-keys";
import { openTestD1, type TestD1 } from "./support/d1";

/** The real senders: web push signs its VAPID JWT with the configured subject (default opengame.org). */
let d1: TestD1;
beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(() => d1.reset());
afterEach(() => vi.unstubAllGlobals());

const sub = { endpoint: "https://push.example.net/x", p256dh: "BPk", auth: "au" };
const payload = { title: "t", body: "b", url: "https://cb.example/", whenOpen: "deliver" as const };

async function subjectSent(env: { PUSH_VAPID_SUBJECT?: string }) {
  await vapidKeysFor(d1.db, "codebreakers", "s", 1);
  const auths: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    auths.push(new Headers(init.headers).get("authorization") ?? "");
    return new Response(null, { status: 201 });
  });
  const real = {
    ...sub,
    p256dh: await realP256dh(),
    auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const senders = pushSenders({ DB: d1.db, PUSH_KEY_SECRET: "s", ...env }, 1);
  expect(await senders.web("codebreakers", real, payload)).toBe("ok");
  const jwt = auths[0]?.match(/t=([^,]+)/)?.[1] ?? "";
  return JSON.parse(atob((jwt.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/"))).sub;
}

/** A browser's p256dh: a fresh ECDH P-256 public key, raw, base64url. */
async function realP256dh() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  if (!("publicKey" in pair)) throw new Error("no pair");
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  if (!(raw instanceof ArrayBuffer)) throw new Error("no raw key");
  return base64url(new Uint8Array(raw));
}

describe("pushSenders: web", () => {
  it("signs with PUSH_VAPID_SUBJECT when set", async () => {
    expect(await subjectSent({ PUSH_VAPID_SUBJECT: "mailto:push@opengame.org" })).toBe(
      "mailto:push@opengame.org",
    );
  });

  it("signs with https://opengame.org by default", async () => {
    expect(await subjectSent({})).toBe(DEFAULT_VAPID_SUBJECT);
    expect(DEFAULT_VAPID_SUBJECT).toBe("https://opengame.org");
  });

  it("errors without PUSH_KEY_SECRET", async () => {
    const senders = pushSenders({ DB: d1.db }, 1);
    expect(await senders.web("codebreakers", sub, payload)).toBe("error");
  });
});
