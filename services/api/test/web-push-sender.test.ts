import { createECDH, createPublicKey, verify, webcrypto } from "node:crypto";
// @ts-expect-error http_ece ships no types (test-only reference decoder for RFC 8188 / 8291)
import ece from "http_ece";
import { describe, expect, it } from "vitest";
import { sendWebPush, webPushTopic } from "../src/lib/web-push-sender";

/**
 * The web push sender (spec §9): RFC 8291 aes128gcm + RFC 8292 VAPID through
 * @block65/webcrypto-web-push. Proven by decrypting the body with http_ece (the reference
 * implementation web-push uses) and verifying the VAPID JWT with Node's crypto.
 */
const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");

/** A browser's subscription: an ECDH P-256 key pair and a 16-byte auth secret. */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    ecdh,
    auth,
    sub: {
      endpoint: "https://push.example.net/send/abc",
      p256dh: b64url(ecdh.getPublicKey()),
      auth: b64url(auth),
    },
  };
}

async function vapidPair() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  const x = Buffer.from(jwk.x ?? "", "base64url");
  const y = Buffer.from(jwk.y ?? "", "base64url");
  return {
    publicKey: b64url(Buffer.concat([Buffer.from([4]), x, y])),
    privateKey: jwk.d ?? "",
    jwk,
  };
}

const payload = {
  title: "Clue: RIVER 2",
  body: "Your guess.",
  url: "https://cb.example/room/KQTP",
  whenOpen: "deliver" as const,
  tag: "cb-KQTP",
};

function recorder(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status });
  };
  return { calls, fetch };
}

describe("sending a web push", () => {
  it("encrypts the payload so the browser's keys decrypt it (aes128gcm)", async () => {
    const b = browser();
    const vapid = await vapidPair();
    const r = recorder(201);
    await expect(
      sendWebPush(b.sub, payload, vapid, { subject: "https://opengame.org", fetch: r.fetch }),
    ).resolves.toBe("ok");
    const call = r.calls[0];
    if (!call) throw new Error("nothing sent");
    expect(call.url).toBe(b.sub.endpoint);
    expect(call.init.method?.toUpperCase()).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("ttl")).toBe("86400");
    expect(headers.get("urgency")).toBe("normal");
    expect(headers.get("topic")).toBe(await webPushTopic("cb-KQTP"));
    const plain = ece.decrypt(Buffer.from(call.init.body as Uint8Array), {
      version: "aes128gcm",
      privateKey: b.ecdh,
      authSecret: b64url(b.auth),
    });
    expect(JSON.parse(plain.toString("utf8").replace(/\0+$/, ""))).toEqual(payload);
  });

  it("signs a VAPID JWT for the push service's origin with the game's key", async () => {
    const b = browser();
    const vapid = await vapidPair();
    const r = recorder(201);
    await sendWebPush(b.sub, payload, vapid, { subject: "https://opengame.org", fetch: r.fetch });
    const auth = new Headers(r.calls[0]?.init.headers).get("authorization") ?? "";
    const m = auth.match(/^vapid t=([^,]+), k=(.+)$/);
    if (!m?.[1] || !m[2]) throw new Error(`bad authorization: ${auth}`);
    expect(m[2]).toBe(vapid.publicKey);
    const [h, p, s] = m[1].split(".");
    const claims = JSON.parse(Buffer.from(p ?? "", "base64url").toString());
    expect(claims).toMatchObject({ aud: "https://push.example.net", sub: "https://opengame.org" });
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: vapid.jwk.x, y: vapid.jwk.y },
      format: "jwk",
    });
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(s ?? "", "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("no tag: no topic", async () => {
    const r = recorder(201);
    const { tag: _, ...noTag } = payload;
    await sendWebPush(browser().sub, noTag, await vapidPair(), {
      subject: "https://opengame.org",
      fetch: r.fetch,
    });
    expect(new Headers(r.calls[0]?.init.headers).has("topic")).toBe(false);
  });

  it("maps the push service's answer: 2xx ok, 404 and 410 gone, anything else error", async () => {
    const vapid = await vapidPair();
    for (const [status, want] of [
      [200, "ok"],
      [202, "ok"],
      [404, "gone"],
      [410, "gone"],
      [400, "error"],
      [429, "error"],
      [500, "error"],
    ] as const) {
      const r = recorder(status);
      expect(
        await sendWebPush(browser().sub, payload, vapid, {
          subject: "https://opengame.org",
          fetch: r.fetch,
        }),
        String(status),
      ).toBe(want);
    }
  });

  it("a network failure or a bad subscription is an error, never a throw", async () => {
    const vapid = await vapidPair();
    const offline = async () => {
      throw new Error("offline");
    };
    expect(
      await sendWebPush(browser().sub, payload, vapid, {
        subject: "https://opengame.org",
        fetch: offline,
      }),
    ).toBe("error");
    const bad = { endpoint: "https://push.example.net/x", p256dh: "nope", auth: "nope" };
    expect(
      await sendWebPush(bad, payload, vapid, {
        subject: "https://opengame.org",
        fetch: recorder(201).fetch,
      }),
    ).toBe("error");
  });
});

describe("the web push topic (RFC 8030: at most 32 url-safe characters)", () => {
  it("is a stable 32-character hash of the tag", async () => {
    const t = await webPushTopic("codebreakers-KQTP");
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await webPushTopic("codebreakers-KQTP")).toBe(t);
    expect(await webPushTopic("codebreakers-ABCD")).not.toBe(t);
  });
});
