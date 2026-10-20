import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tvStartPath, wsProbe } from "../../../packages/try-kit/src/worker";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import { checkTryPath } from "../src/lib/try-paths";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * The deliver group's API (docs/design-docs/ogs-cli.md, "PUT /api/v1/apps/:appId/try" and
 * "ogs push send"): registering a game's try path, and the read-only look at a push handle. Real
 * local D1; the try path's two checks go to a stand-in try-kit Worker at fetch (never the network).
 */
const TRY = "https://rocket-crew-try.example.workers.dev";
const TRY_V2 = "https://rocket-crew-try-v2.example.workers.dev";
let d1: TestD1;
let rcKey: string;
let cbKey: string;
let tryWorker: (req: Request) => Response;
let fetched: string[];

/** A try-kit Worker's two routes, from try-kit itself: `/` → a new room's TV page, `/ws-probe`. */
const realTryWorker = (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname === "/")
    return Response.redirect(new URL(tvStartPath(url, "ABCD"), url).href, 302);
  if (url.pathname === "/ws-probe") return wsProbe(req);
  return new Response("not found", { status: 404 });
};

beforeAll(async () => {
  d1 = await openTestD1();
}, 120_000);
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const rc = await generateApiKey();
  const cb = await generateApiKey();
  rcKey = rc.key;
  cbKey = cb.key;
  await d1.db.batch([
    d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-rc', 'rocket-crew', ?, ?, 'notifications:send', 1)",
      )
      .bind(rc.prefix, rc.hash),
    d1.db
      .prepare(
        "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES ('k-cb', 'codebreakers', ?, ?, 'notifications:send', 1)",
      )
      .bind(cb.prefix, cb.hash),
  ]);
  tryWorker = realTryWorker;
  fetched = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    fetched.push(`${req.method} ${req.url} redirect=${req.redirect}`);
    if (!req.url.startsWith(`${TRY}/`) && !req.url.startsWith(`${TRY_V2}/`))
      throw new TypeError(`unexpected fetch ${req.url}`);
    return tryWorker(req);
  });
});
afterEach(() => vi.unstubAllGlobals());

async function call(method: string, path: string, key: string | null, body?: unknown) {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { DB: d1.db },
  );
  return { status: res.status, body: z.record(z.string(), z.unknown()).parse(await res.json()) };
}
const errorOf = (res: { body: Record<string, unknown> }) =>
  z
    .object({ error: z.object({ code: z.string(), message: z.string(), status: z.number() }) })
    .parse(res.body).error;
const putTry = (url: unknown, key = rcKey, appId = "rocket-crew") =>
  call("PUT", `/api/v1/apps/${appId}/try`, key, { url });

describe("checkTryPath", { timeout: 20_000 }, () => {
  const via =
    (worker: (req: Request) => Response) => async (input: RequestInfo | URL, init?: RequestInit) =>
      worker(new Request(input, init));

  it("passes a try-kit Worker: / redirects to a TV page and /ws-probe answers 426", async () => {
    expect(await checkTryPath(TRY, via(realTryWorker))).toEqual([]);
  });
  it("asks / without following the redirect", async () => {
    const seen: string[] = [];
    await checkTryPath(TRY, async (input, init) => {
      const req = new Request(input, init);
      seen.push(`${new URL(req.url).pathname} ${req.redirect}`);
      return realTryWorker(req);
    });
    expect(seen).toEqual(["/ manual", "/ws-probe manual"]);
  });
  it("names / when it answers a page instead of a redirect", async () => {
    const failed = await checkTryPath(
      TRY,
      via((req) =>
        new URL(req.url).pathname === "/" ? new Response("<html>") : realTryWorker(req),
      ),
    );
    expect(failed).toEqual([`GET ${TRY}/ answered 200, not a redirect to a TV page`]);
  });
  it("names / when its redirect has no Location", async () => {
    const failed = await checkTryPath(
      TRY,
      via((req) =>
        new URL(req.url).pathname === "/"
          ? new Response(null, { status: 302 })
          : realTryWorker(req),
      ),
    );
    expect(failed).toEqual([`GET ${TRY}/ answered 302, not a redirect to a TV page`]);
  });
  it("names /ws-probe when it isn't try-kit's probe", async () => {
    const failed = await checkTryPath(
      TRY,
      via((req) => (new URL(req.url).pathname === "/" ? realTryWorker(req) : new Response("hi"))),
    );
    expect(failed).toEqual([`GET ${TRY}/ws-probe answered 200, not 426 (try-kit's wsProbe)`]);
  });
  it("names both, and a check that couldn't connect", async () => {
    const failed = await checkTryPath(TRY, async () => {
      throw new TypeError("connection refused");
    });
    expect(failed).toEqual([
      `GET ${TRY}/ failed: connection refused`,
      `GET ${TRY}/ws-probe failed: connection refused`,
    ]);
  });
  it("checks the URL's own path when it has one", async () => {
    const seen: string[] = [];
    await checkTryPath(`${TRY}/try/`, async (input, init) => {
      seen.push(new Request(input, init).url);
      return new Response("x");
    });
    expect(seen).toEqual([`${TRY}/try/`, `${TRY}/try/ws-probe`]);
  });
});

describe("PUT /api/v1/apps/:appId/try", { timeout: 20_000 }, () => {
  it("checks a try-kit Worker and stores its URL", async () => {
    const res = await putTry(TRY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ appId: "rocket-crew", url: TRY, checkedAt: expect.any(String) });
    expect(Date.parse(z.string().parse(res.body.checkedAt))).toBeGreaterThan(Date.now() - 60_000);
    expect(fetched).toEqual([`GET ${TRY}/ redirect=manual`, `GET ${TRY}/ws-probe redirect=manual`]);
    const got = await call("GET", "/api/v1/apps/rocket-crew/try", rcKey);
    expect(got).toEqual({ status: 200, body: res.body });
  });

  it("a newer URL replaces the old one", async () => {
    await putTry(TRY);
    expect((await putTry(TRY_V2)).status).toBe(200);
    const got = await call("GET", "/api/v1/apps/rocket-crew/try", rcKey);
    expect(got.body.url).toBe(TRY_V2);
  });

  it("answers 422 try_path_not_found naming the failed check, and stores nothing", async () => {
    tryWorker = (req) =>
      new URL(req.url).pathname === "/" ? new Response("<html>") : realTryWorker(req);
    const res = await putTry(TRY);
    expect(res.status).toBe(422);
    expect(errorOf(res)).toEqual({
      code: "try_path_not_found",
      message: `GET ${TRY}/ answered 200, not a redirect to a TV page`,
      status: 422,
    });
    expect(errorOf(await call("GET", "/api/v1/apps/rocket-crew/try", rcKey)).code).toBe(
      "no_try_path",
    );
  });

  it("names every failed check", async () => {
    tryWorker = () => new Response("not found", { status: 404 });
    const res = await putTry(TRY);
    expect(errorOf(res).message).toBe(
      `GET ${TRY}/ answered 404, not a redirect to a TV page; GET ${TRY}/ws-probe answered 404, not 426 (try-kit's wsProbe)`,
    );
  });

  it("needs an https URL", async () => {
    for (const url of ["http://rocket-crew-try.example/", "try", 42, undefined]) {
      const res = await putTry(url);
      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe("invalid_body");
    }
    expect(fetched).toEqual([]);
  });

  it("only the game's own key registers or reads its try path", async () => {
    expect(errorOf(await putTry(TRY, cbKey)).code).toBe("wrong_game");
    expect(errorOf(await call("GET", "/api/v1/apps/rocket-crew/try", cbKey)).code).toBe(
      "wrong_game",
    );
    expect((await call("PUT", "/api/v1/apps/rocket-crew/try", null, { url: TRY })).status).toBe(
      401,
    );
    expect(fetched).toEqual([]);
  });

  it("GET before any registration is 404 no_try_path", async () => {
    const res = await call("GET", "/api/v1/apps/rocket-crew/try", rcKey);
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("no_try_path");
  });
});

describe("the catalogue's tryUrl", { timeout: 20_000 }, () => {
  const catalogue = async () => {
    const res = await app.request("/api/v1/catalogue", {}, { DB: d1.db });
    return z
      .array(z.object({ appId: z.string(), tryUrl: z.string().optional() }))
      .parse(await res.json());
  };

  it("the game with a registered try path has its tryUrl; the others have none", async () => {
    expect((await catalogue()).some((m) => m.tryUrl)).toBe(false);
    await putTry(TRY);
    const games = await catalogue();
    expect(games.find((m) => m.appId === "rocket-crew")?.tryUrl).toBe(TRY);
    expect(games.filter((m) => m.tryUrl).map((m) => m.appId)).toEqual(["rocket-crew"]);
  });
});

describe("GET /api/v1/games/:appId/push-handles/:handle", { timeout: 20_000 }, () => {
  const HANDLE = "ph_rocketcrew_handle_0001";
  beforeEach(async () => {
    await d1.db.batch([
      d1.db.prepare(
        "INSERT INTO profiles (id, handle, name, sticker) VALUES ('sam', 'sam', 'Sam', 'owl')",
      ),
      d1.db.prepare(
        "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('sam-phone', 'sam', 'phone', 'Phone')",
      ),
      d1.db
        .prepare("INSERT INTO push_handles (id, app_id, created_at) VALUES (?, 'rocket-crew', 1)")
        .bind(HANDLE),
    ]);
  });
  const ogsSurface = (lastActiveAt: number) =>
    d1.db
      .prepare(
        "INSERT INTO push_surfaces (id, handle_id, kind, profile_id, last_active_at, created_at) VALUES ('s-ogs', ?, 'ogs', 'sam', ?, 1)",
      )
      .bind(HANDLE, lastActiveAt);
  const ogsAppPhone = () =>
    d1.db.prepare(
      "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('sam-phone', 'ios', 'ExponentPushToken[sam]')",
    );
  const ownAppPhone = (appId = "rocket-crew") =>
    d1.db
      .prepare(
        "INSERT INTO app_devices (device_id, app_id, platform, token, apns_environment, updated_at) VALUES ('sam-phone', ?, 'ios', 'apns-token-sam', 'sandbox', 1)",
      )
      .bind(appId);
  const webSurface = (lastActiveAt: number) =>
    d1.db
      .prepare(
        "INSERT INTO push_surfaces (id, handle_id, kind, endpoint, p256dh, auth, last_active_at, created_at) VALUES ('s-web', ?, 'web', 'https://push.example/sub-secret', 'p256', 'authsecret', ?, 1)",
      )
      .bind(HANDLE, lastActiveAt);
  const look = (key = rcKey, appId = "rocket-crew", handle = HANDLE) =>
    call("GET", `/api/v1/games/${appId}/push-handles/${handle}`, key);

  it("lists where the handle reaches, most recent first, with no ids or tokens", async () => {
    await d1.db.batch([
      ogsSurface(Date.UTC(2026, 9, 18, 10)),
      ogsAppPhone(),
      ownAppPhone(),
      webSurface(Date.UTC(2026, 9, 18, 12)),
    ]);
    const res = await look();
    expect(res).toEqual({
      status: 200,
      body: {
        handle: HANDLE,
        surfaces: [
          { kind: "web", lastActiveAt: "2026-10-18T12:00:00.000Z" },
          { kind: "ogs", lastActiveAt: "2026-10-18T10:00:00.000Z" },
          { kind: "app", lastActiveAt: "2026-10-18T10:00:00.000Z" },
        ],
      },
    });
    const text = JSON.stringify(res.body);
    for (const secret of [
      "sam",
      "s-ogs",
      "s-web",
      "ExponentPushToken",
      "apns-token",
      "push.example",
      "p256",
      "authsecret",
    ])
      expect(text).not.toContain(secret);
  });

  it("an OGS profile with only this game's own app on its phone is an app surface", async () => {
    await d1.db.batch([ogsSurface(Date.UTC(2026, 9, 18, 10)), ownAppPhone()]);
    expect((await look()).body.surfaces).toEqual([
      { kind: "app", lastActiveAt: "2026-10-18T10:00:00.000Z" },
    ]);
  });

  it("another game's white-label app is not a surface of this handle", async () => {
    await d1.db.batch([
      ogsSurface(Date.UTC(2026, 9, 18, 10)),
      ogsAppPhone(),
      ownAppPhone("codebreakers"),
    ]);
    expect((await look()).body.surfaces).toEqual([
      { kind: "ogs", lastActiveAt: "2026-10-18T10:00:00.000Z" },
    ]);
  });

  it("a kid's tablet is never a surface", async () => {
    await d1.db.batch([
      d1.db.prepare("UPDATE profile_devices SET kind = 'tablet' WHERE device_id = 'sam-phone'"),
      ogsSurface(1),
      ogsAppPhone(),
      ownAppPhone(),
    ]);
    expect((await look()).body.surfaces).toEqual([]);
  });

  it("a handle with nowhere to go has no surfaces", async () => {
    expect(await look()).toEqual({ status: 200, body: { handle: HANDLE, surfaces: [] } });
  });

  it("an unknown handle, or another game's, is 404 handle_not_found", async () => {
    for (const res of [
      await look(rcKey, "rocket-crew", "ph_nobody_nobody_0000"),
      await look(cbKey, "codebreakers"),
    ]) {
      expect(res.status).toBe(404);
      expect(errorOf(res).code).toBe("handle_not_found");
    }
  });

  it("only the game's own key looks", async () => {
    expect(errorOf(await look(cbKey)).code).toBe("wrong_game");
    expect(
      (await call("GET", `/api/v1/games/rocket-crew/push-handles/${HANDLE}`, null)).status,
    ).toBe(401);
  });
});

describe("the try path's checks and words, at their edges", { timeout: 20_000 }, () => {
  /** `/` answers `status` with a Location; `/ws-probe` is try-kit's. */
  const homeAnswers = (status: number) => async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return new URL(req.url).pathname === "/"
      ? new Response(null, { status, headers: { Location: `${TRY}/tv/ABCD` } })
      : realTryWorker(req);
  };

  it.each([300, 399])("a %i with a Location is a redirect to a TV page", async (status) => {
    expect(await checkTryPath(TRY, homeAnswers(status))).toEqual([]);
  });

  it.each([299, 400])("a %i (even with a Location) is not", async (status) => {
    expect(await checkTryPath(TRY, homeAnswers(status))).toEqual([
      `GET ${TRY}/ answered ${status}, not a redirect to a TV page`,
    ]);
  });

  it("every trailing slash of the URL is dropped before its routes", async () => {
    const seen: string[] = [];
    await checkTryPath(`${TRY}/try//`, async (input, init) => {
      seen.push(new Request(input, init).url);
      return new Response("x");
    });
    expect(seen).toEqual([`${TRY}/try/`, `${TRY}/try/ws-probe`]);
  });

  it.each([
    "xhttps://x.example/",
    "httpsx://x.example/",
  ])("refuses %s (only https)", async (url) => {
    expect((await putTry(url)).status).toBe(400);
  });

  it("a bad body says an https url is required", async () => {
    expect(errorOf(await putTry("http://x.example/"))).toEqual({
      code: "invalid_body",
      message: "url (https) is required",
      status: 400,
    });
  });

  it("no try path says how to register one", async () => {
    expect(errorOf(await call("GET", "/api/v1/apps/rocket-crew/try", rcKey))).toEqual({
      code: "no_try_path",
      message: "No try path registered for this game; run: ogs try",
      status: 404,
    });
  });
});
