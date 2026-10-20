import { describe, expect, it } from "vitest";
import { apnsProviderToken, fcmAccessToken, sendApns, sendFcm } from "../src/lib/native-push";
import { ServiceAccountSchema } from "../src/lib/push-credentials";
import { fcmServiceAccountPair, p8Pair } from "./support/keys";

/**
 * APNs and FCM senders in detail (ADR 2026-10-18-multi-tenant-push): the requests they make, how they
 * read refusals, and how long they reuse tokens. APNs, FCM and Google OAuth are fakes at fetch.
 * Every test makes fresh keys, so the module's token cache never carries over between tests.
 */
type Call = { url: string; init: RequestInit };
function fakeFetch(answer: (url: string, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return answer(url, calls.length);
  };
  return { calls, fetcher };
}
const b64urlText = (s: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  );
const jwtOf = (jwt: string) => {
  const [h = "", p = ""] = jwt.split(".");
  return { header: JSON.parse(b64urlText(h)), claims: JSON.parse(b64urlText(p)) };
};
const headerOf = (c: Call | undefined, name: string) => new Headers(c?.init.headers).get(name);
const N = { title: "Launch window", body: "Your crew is waiting.", data: { appId: "rocket-crew" } };
const T0 = 1_760_000_000_000;
const MIN = 60_000;
const account = async () =>
  ServiceAccountSchema.parse((await fcmServiceAccountPair()).serviceAccount);

async function apnsCred() {
  return { keyId: "ABC123DEFG", teamId: "34S957HD77", p8: (await p8Pair()).pem };
}
const IPHONE = {
  platform: "ios" as const,
  token: "a".repeat(64),
  apnsEnvironment: "production" as const,
  bundleId: "tv.rocketcrew.app",
};
const PIXEL = { platform: "android" as const, token: "fcm-token-1" };
const oauthOk = (token = "ya29.one") => Response.json({ access_token: token, expires_in: 3600 });

describe("sendApns", () => {
  it("POSTs the alert to the device on APNs production with the provider token and push headers", async () => {
    const cred = await apnsCred();
    const { calls, fetcher } = fakeFetch(() => new Response(null, { status: 200 }));
    expect(await sendApns(cred, IPHONE, N, T0, fetcher)).toEqual({
      success: true,
      deviceActive: true,
    });
    const [c] = calls;
    expect(c?.url).toBe(`https://api.push.apple.com/3/device/${IPHONE.token}`);
    expect(c?.init.method).toBe("POST");
    expect(headerOf(c, "apns-topic")).toBe("tv.rocketcrew.app");
    expect(headerOf(c, "apns-push-type")).toBe("alert");
    expect(headerOf(c, "apns-priority")).toBe("10");
    expect(headerOf(c, "content-type")).toBe("application/json");
    const auth = headerOf(c, "authorization") ?? "";
    expect(auth.startsWith("bearer ")).toBe(true);
    expect(jwtOf(auth.slice("bearer ".length))).toEqual({
      header: { alg: "ES256", kid: "ABC123DEFG" },
      claims: { iss: "34S957HD77", iat: Math.floor(T0 / 1000) },
    });
    expect(JSON.parse(String(c?.init.body))).toEqual({
      aps: { alert: { title: N.title, body: N.body }, sound: "default" },
      ogs: { appId: "rocket-crew" },
    });
  });

  it("sends an empty ogs object when the notification has no data", async () => {
    const { calls, fetcher } = fakeFetch(() => new Response(null, { status: 200 }));
    await sendApns(await apnsCred(), IPHONE, { title: "t", body: "b" }, T0, fetcher);
    expect(JSON.parse(String(calls[0]?.init.body)).ogs).toEqual({});
  });

  it("a sandbox device goes to APNs' sandbox host", async () => {
    const { calls, fetcher } = fakeFetch(() => new Response(null, { status: 200 }));
    await sendApns(await apnsCred(), { ...IPHONE, apnsEnvironment: "sandbox" }, N, T0, fetcher);
    expect(calls[0]?.url).toBe(`https://api.sandbox.push.apple.com/3/device/${IPHONE.token}`);
  });

  it("a key that isn't a key: nothing is sent, the device stays", async () => {
    const { calls, fetcher } = fakeFetch(() => new Response(null, { status: 200 }));
    expect(
      await sendApns(
        { keyId: "ABC123DEFG", teamId: "34S957HD77", p8: "nope" },
        IPHONE,
        N,
        T0,
        fetcher,
      ),
    ).toEqual({
      success: false,
      deviceActive: true,
      error: "apns_key_unusable",
    });
    expect(calls).toEqual([]);
  });

  it.each([
    "BadDeviceToken",
    "Unregistered",
    "DeviceTokenNotForTopic",
  ])("reason %s means the token is gone", async (reason) => {
    const { fetcher } = fakeFetch(() => Response.json({ reason }, { status: 400 }));
    expect(await sendApns(await apnsCred(), IPHONE, N, T0, fetcher)).toEqual({
      success: false,
      deviceActive: false,
      error: reason,
    });
  });

  it("another reason keeps the device and is the error", async () => {
    const { fetcher } = fakeFetch(() =>
      Response.json({ reason: "TooManyRequests" }, { status: 429 }),
    );
    expect(await sendApns(await apnsCred(), IPHONE, N, T0, fetcher)).toEqual({
      success: false,
      deviceActive: true,
      error: "TooManyRequests",
    });
  });

  it("410 is gone whatever the reason", async () => {
    const { fetcher } = fakeFetch(() => Response.json({ reason: "ExpiredToken" }, { status: 410 }));
    expect(await sendApns(await apnsCred(), IPHONE, N, T0, fetcher)).toEqual({
      success: false,
      deviceActive: false,
      error: "ExpiredToken",
    });
  });

  it("no readable reason: the status is the error, and 410 is still gone", async () => {
    const plain = fakeFetch(() => new Response("oops", { status: 500 }));
    expect(await sendApns(await apnsCred(), IPHONE, N, T0, plain.fetcher)).toEqual({
      success: false,
      deviceActive: true,
      error: "apns_500",
    });
    const gone = fakeFetch(() => new Response("", { status: 410 }));
    expect(await sendApns(await apnsCred(), IPHONE, N, T0, gone.fetcher)).toEqual({
      success: false,
      deviceActive: false,
      error: "apns_410",
    });
    const wrongShape = fakeFetch(() => Response.json({ reason: 7 }, { status: 400 }));
    expect(await sendApns(await apnsCred(), IPHONE, N, T0, wrongShape.fetcher)).toEqual({
      success: false,
      deviceActive: true,
      error: "apns_400",
    });
  });
});

describe("apnsProviderToken reuse", () => {
  it("reuses the token for 50 minutes, then signs a new one", async () => {
    const cred = await apnsCred();
    const first = await apnsProviderToken(cred, T0);
    expect(await apnsProviderToken(cred, T0 + 50 * MIN - 1)).toBe(first);
    const next = await apnsProviderToken(cred, T0 + 50 * MIN);
    expect(next).not.toBe(first);
    expect(jwtOf(next ?? "").claims.iat).toBe(Math.floor((T0 + 50 * MIN) / 1000));
  });

  it("a rotated key, key id or team id gets its own token", async () => {
    const cred = await apnsCred();
    const first = await apnsProviderToken(cred, T0);
    expect(await apnsProviderToken({ ...cred, p8: (await p8Pair()).pem }, T0)).not.toBe(first);
    expect(
      jwtOf((await apnsProviderToken({ ...cred, keyId: "ZZZ123DEFG" }, T0)) ?? "").header.kid,
    ).toBe("ZZZ123DEFG");
    expect(
      jwtOf((await apnsProviderToken({ ...cred, teamId: "ZZZ957HD77" }, T0)) ?? "").claims.iss,
    ).toBe("ZZZ957HD77");
  });
});

describe("sendFcm", () => {
  it("gets an OAuth token with a signed assertion, then POSTs the message to the project", async () => {
    const serviceAccount = await account();
    const { calls, fetcher } = fakeFetch((url) =>
      url === serviceAccount.token_uri ? oauthOk() : Response.json({ name: "m/1" }),
    );
    expect(await sendFcm(serviceAccount, PIXEL, N, T0, fetcher)).toEqual({
      success: true,
      deviceActive: true,
    });
    const [oauth, fcm] = calls;
    expect(oauth?.url).toBe("https://oauth2.googleapis.com/token");
    expect(oauth?.init.method).toBe("POST");
    expect(headerOf(oauth, "content-type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(oauth?.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const iat = Math.floor(T0 / 1000);
    expect(jwtOf(form.get("assertion") ?? "")).toEqual({
      header: { alg: "RS256", typ: "JWT" },
      claims: {
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: serviceAccount.token_uri,
        iat,
        exp: iat + 3600,
      },
    });
    expect(fcm?.url).toBe(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    );
    expect(fcm?.init.method).toBe("POST");
    expect(headerOf(fcm, "authorization")).toBe("Bearer ya29.one");
    expect(headerOf(fcm, "content-type")).toBe("application/json");
    expect(JSON.parse(String(fcm?.init.body))).toEqual({
      message: {
        token: PIXEL.token,
        notification: { title: N.title, body: N.body },
        data: { appId: "rocket-crew" },
        android: { priority: "high" },
      },
    });
  });

  it("sends empty data when the notification has none", async () => {
    const serviceAccount = await account();
    const { calls, fetcher } = fakeFetch((url) =>
      url === serviceAccount.token_uri ? oauthOk() : Response.json({}),
    );
    await sendFcm(serviceAccount, PIXEL, { title: "t", body: "b" }, T0, fetcher);
    expect(JSON.parse(String(calls[1]?.init.body)).message.data).toEqual({});
  });

  it.each([
    ["the OAuth endpoint refuses", () => new Response("no", { status: 401 })],
    ["the OAuth answer has no access token", () => Response.json({ token_type: "Bearer" })],
    ["the OAuth access token is empty", () => Response.json({ access_token: "" })],
  ])("no message is sent when %s", async (_what, oauth) => {
    const serviceAccount = await account();
    const { calls, fetcher } = fakeFetch((url) =>
      url === serviceAccount.token_uri ? oauth() : Response.json({}),
    );
    expect(await sendFcm(serviceAccount, PIXEL, N, T0, fetcher)).toEqual({
      success: false,
      deviceActive: true,
      error: "fcm_auth_failed",
    });
    expect(calls.map((c) => c.url)).toEqual([serviceAccount.token_uri]);
  });

  it("a private key that isn't a key: nothing is fetched", async () => {
    const serviceAccount = await account();
    const { calls, fetcher } = fakeFetch(() => oauthOk());
    expect(
      await sendFcm({ ...serviceAccount, private_key: "nope" }, PIXEL, N, T0, fetcher),
    ).toMatchObject({ error: "fcm_auth_failed" });
    expect(calls).toEqual([]);
  });

  it.each([
    ["404", 404, "{}", false],
    [
      "UNREGISTERED in the body",
      400,
      JSON.stringify({ error: { details: [{ errorCode: "UNREGISTERED" }] } }),
      false,
    ],
    ["another error", 500, "{}", true],
  ])("a refusal (%s) says whether the token is gone", async (_what, status, body, deviceActive) => {
    const serviceAccount = await account();
    const { fetcher } = fakeFetch((url) =>
      url === serviceAccount.token_uri ? oauthOk() : new Response(body, { status }),
    );
    expect(await sendFcm(serviceAccount, PIXEL, N, T0, fetcher)).toEqual({
      success: false,
      deviceActive,
      error: `fcm_${status}`,
    });
  });
});

describe("fcmAccessToken reuse", () => {
  it("reuses the OAuth token for 50 minutes, then asks again", async () => {
    const serviceAccount = await account();
    const { calls, fetcher } = fakeFetch((_url, n) => oauthOk(`ya29.${n}`));
    expect(await fcmAccessToken(serviceAccount, T0, fetcher)).toBe("ya29.1");
    expect(await fcmAccessToken(serviceAccount, T0 + 50 * MIN - 1, fetcher)).toBe("ya29.1");
    expect(await fcmAccessToken(serviceAccount, T0 + 50 * MIN, fetcher)).toBe("ya29.2");
    expect(calls).toHaveLength(2);
  });

  it("a failed exchange isn't remembered: the next send asks again", async () => {
    const serviceAccount = await account();
    const { fetcher } = fakeFetch((_url, n) =>
      n === 1 ? new Response("no", { status: 503 }) : oauthOk("ya29.later"),
    );
    expect(await fcmAccessToken(serviceAccount, T0, fetcher)).toBeNull();
    expect(await fcmAccessToken(serviceAccount, T0 + 1, fetcher)).toBe("ya29.later");
  });

  it("another service account (or a rotated key) gets its own token", async () => {
    const serviceAccount = await account();
    const { fetcher } = fakeFetch((_url, n) => oauthOk(`ya29.${n}`));
    expect(await fcmAccessToken(serviceAccount, T0, fetcher)).toBe("ya29.1");
    expect(
      await fcmAccessToken(
        { ...serviceAccount, client_email: "other@x.iam.gserviceaccount.com" },
        T0,
        fetcher,
      ),
    ).toBe("ya29.2");
    const rotated = await account();
    expect(
      await fcmAccessToken({ ...serviceAccount, private_key: rotated.private_key }, T0, fetcher),
    ).toBe("ya29.3");
  });
});
