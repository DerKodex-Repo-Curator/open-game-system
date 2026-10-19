import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CATALOGUE } from "../src/catalogue";
import app from "../src/index";
import { generateApiKey } from "../src/lib/api-keys";
import type { Probe } from "../src/lib/manifest-check";
import { catalogueEntries } from "../src/routes/catalogue-entries";
import type { Env } from "../src/types";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * The catalogue's developer API (docs/design-docs/ogs-cli.md; docs/acceptance/2026-10-18-ogs-developer-tool.feature):
 * manifests/check, a game's catalogue entry (its key), the admin's review, and the catalogue it feeds.
 * Real local D1; the live checks go to a stand-in probe, never the network.
 */
const ADMIN = "admin-token-for-tests";
let d1: TestD1;
let ccKey: string;
let rcKey: string;
let cbKey: string;
let probed: string[];
let probe: Probe;

beforeAll(async () => {
  d1 = await openTestD1();
}, 60_000);
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const cc = await generateApiKey();
  const rc = await generateApiKey();
  const cb = await generateApiKey();
  ccKey = cc.key;
  rcKey = rc.key;
  cbKey = cb.key;
  await d1.db.batch(
    (
      [
        ["k-cc", "comet-catch", cc],
        ["k-rc", "rocket-crew", rc],
        ["k-cb", "codebreakers", cb],
      ] as const
    ).map(([id, appId, k]) =>
      d1.db
        .prepare(
          "INSERT INTO game_api_keys (id, app_id, prefix, key_hash, scope, created_at) VALUES (?, ?, ?, ?, 'notifications:send', 1)",
        )
        .bind(id, appId, k.prefix, k.hash),
    ),
  );
  probed = [];
  probe = async (url) => {
    probed.push(url);
    return { status: 200, headers: new Headers() };
  };
});

const testApp = () =>
  new Hono<{ Bindings: Env }>()
    .route(
      "/api/v1",
      catalogueEntries((url) => probe(url)),
    )
    .route("/", app);

type Extra = {
  OGS_ADMIN_TOKEN?: string;
  CATALOGUE_START_URLS?: string;
  CLIENT_EVENTS_LIMITER?: RateLimit;
};
async function call(
  method: string,
  path: string,
  auth: string | null,
  body?: unknown,
  extra: Extra = { OGS_ADMIN_TOKEN: ADMIN },
  ip = "203.0.113.9",
) {
  const res = await testApp().request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    },
    { DB: d1.db, OGS_JWT_SECRET: "catalogue-entries-secret", ...extra },
  );
  const text = await res.text();
  return { status: res.status, body: text ? z.unknown().parse(JSON.parse(text)) : null };
}
const Obj = z.record(z.string(), z.unknown());
const obj = (b: unknown) => Obj.parse(b);
const errorCode = (b: unknown) =>
  z.object({ error: z.object({ code: z.string(), status: z.number() }) }).parse(b).error.code;

const COMET = {
  appId: "comet-catch",
  name: "Comet Catch",
  shape: "couch",
  tv: "required",
  startUrl: "https://comet.example/",
  tvUrl: "https://comet.example/tv",
  roles: [
    { id: "pilot", label: "Pilot", audience: "grownup" },
    { id: "catcher", label: "Catcher", audience: "kid" },
  ],
  art: {
    tile: "https://comet.example/art/tile.jpg",
    icon: "https://comet.example/art/icon.png",
    cover: "https://comet.example/art/cover.jpg",
    logo: "https://comet.example/art/logo.png",
    heroClean: "https://comet.example/art/hero.jpg",
  },
};
const ENTRY = "/api/v1/apps/comet-catch/catalogue-entry";
const catalogueIds = async (extra?: Extra) =>
  z
    .array(z.object({ appId: z.string(), name: z.string(), startUrl: z.string() }))
    .parse((await call("GET", "/api/v1/catalogue", null, undefined, extra)).body);

describe("POST /api/v1/manifests/check", { timeout: 20_000 }, () => {
  it("answers a valid manifest with no issues, after GETting its pages (no auth)", async () => {
    const r = await call("POST", "/api/v1/manifests/check", null, COMET);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      valid: true,
      issues: [],
      warnings: [],
      checked: { startUrl: 200, tvUrl: 200, frameable: true },
    });
    expect(probed).toEqual(["https://comet.example/", "https://comet.example/tv"]);
  });

  it("answers 200 with the issues for an invalid manifest", async () => {
    const { startUrl: _s, ...noStart } = COMET;
    const r = await call("POST", "/api/v1/manifests/check", null, noStart);
    expect(r.status).toBe(200);
    expect(obj(r.body).valid).toBe(false);
    expect(
      z
        .array(z.object({ path: z.string() }))
        .parse(obj(r.body).issues)
        .map((i) => i.path),
    ).toEqual(["startUrl"]);
  });

  it("a body that isn't JSON is 400 invalid_body", async () => {
    const r = await call("POST", "/api/v1/manifests/check", null, "not json");
    expect(r.status).toBe(400);
    expect(errorCode(r.body)).toBe("invalid_body");
  });

  it("is rate limited per IP with the shared limiter", async () => {
    const keys: string[] = [];
    const limiter: RateLimit = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: keys.length < 2 };
      },
    };
    expect(
      (
        await call("POST", "/api/v1/manifests/check", null, COMET, {
          CLIENT_EVENTS_LIMITER: limiter,
        })
      ).status,
    ).toBe(200);
    const second = await call("POST", "/api/v1/manifests/check", null, COMET, {
      CLIENT_EVENTS_LIMITER: limiter,
    });
    expect(second.status).toBe(429);
    expect(errorCode(second.body)).toBe("rate_limited");
    expect(keys).toEqual(["manifest-check:203.0.113.9", "manifest-check:203.0.113.9"]);
    expect(probed).toHaveLength(2);
  });
});

describe("a game's catalogue entry", { timeout: 20_000 }, () => {
  it("is none before the first submission", async () => {
    const r = await call("GET", ENTRY, ccKey);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ appId: "comet-catch", status: "none" });
  });

  it("a submission is stored as pending (202), with no live checks", async () => {
    const r = await call("PUT", ENTRY, ccKey, COMET);
    expect(r.status).toBe(202);
    const body = z
      .object({ appId: z.string(), status: z.string(), submittedAt: z.number() })
      .parse(r.body);
    expect(body).toMatchObject({ appId: "comet-catch", status: "pending" });
    expect(probed).toEqual([]);
    const status = obj((await call("GET", ENTRY, ccKey)).body);
    expect(status).toMatchObject({
      appId: "comet-catch",
      status: "pending",
      submittedAt: body.submittedAt,
    });
    expect(obj(status.pending)).toMatchObject({ appId: "comet-catch", name: "Comet Catch" });
    expect(status.live).toBeUndefined();
    expect((await catalogueIds()).map((g) => g.appId)).not.toContain("comet-catch");
  });

  it("a new submission replaces a pending one", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    await call("PUT", ENTRY, ccKey, { ...COMET, name: "Comet Catch 2" });
    expect(obj(obj((await call("GET", ENTRY, ccKey)).body).pending).name).toBe("Comet Catch 2");
  });

  it("an invalid manifest is 400 invalid_manifest with its issues", async () => {
    const r = await call("PUT", ENTRY, ccKey, { ...COMET, shape: "solo" });
    expect(r.status).toBe(400);
    expect(errorCode(r.body)).toBe("invalid_manifest");
    expect(
      z
        .object({ error: z.object({ issues: z.array(z.object({ path: z.string() })) }) })
        .parse(r.body)
        .error.issues.map((i) => i.path),
    ).toEqual(["shape"]);
  });

  it("the manifest's appId must be the path's", async () => {
    const r = await call("PUT", ENTRY, ccKey, { ...COMET, appId: "comet-crash" });
    expect(r.status).toBe(400);
    expect(errorCode(r.body)).toBe("app_id_mismatch");
  });

  it("only the game's key publishes its entry", async () => {
    const r = await call("PUT", "/api/v1/apps/rocket-crew/catalogue-entry", cbKey, {
      ...COMET,
      appId: "rocket-crew",
    });
    expect(r.status).toBe(403);
    expect(errorCode(r.body)).toBe("wrong_game");
    expect((await call("GET", ENTRY, rcKey)).status).toBe(403);
    expect((await call("GET", ENTRY, null)).status).toBe(401);
  });
});

describe("the admin's review", { timeout: 20_000 }, () => {
  const approve = (appId: string, token: string | null = ADMIN, extra?: Extra) =>
    call("POST", `/api/v1/admin/catalogue-entries/${appId}/approve`, token, undefined, extra);
  const reject = (appId: string, note: unknown, token: string | null = ADMIN) =>
    call(
      "POST",
      `/api/v1/admin/catalogue-entries/${appId}/reject`,
      token,
      note === undefined ? undefined : { note },
    );

  it("an approved entry is in the catalogue, after the seed", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    const r = await approve("comet-catch");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ appId: "comet-catch", status: "live" });
    const games = await catalogueIds();
    expect(games.map((g) => g.appId)).toEqual([...CATALOGUE.map((g) => g.appId), "comet-catch"]);
    const status = obj((await call("GET", ENTRY, ccKey)).body);
    expect(status).toMatchObject({ status: "live" });
    expect(typeof status.reviewedAt).toBe("number");
    expect(obj(status.live).name).toBe("Comet Catch");
    expect(status.pending).toBeUndefined();
  });

  it("a live entry stays live until its update is approved", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    await approve("comet-catch");
    await call("PUT", ENTRY, ccKey, { ...COMET, name: "Comet Catch Deluxe" });
    expect((await catalogueIds()).find((g) => g.appId === "comet-catch")?.name).toBe("Comet Catch");
    const status = obj((await call("GET", ENTRY, ccKey)).body);
    expect(status.status).toBe("pending");
    expect(obj(status.live).name).toBe("Comet Catch");
    expect(obj(status.pending).name).toBe("Comet Catch Deluxe");
    await approve("comet-catch");
    expect((await catalogueIds()).find((g) => g.appId === "comet-catch")?.name).toBe(
      "Comet Catch Deluxe",
    );
  });

  it("an approved entry for a seed game replaces it in place", async () => {
    const rocket = { ...COMET, appId: "rocket-crew", name: "Rocket Crew II" };
    await call("PUT", "/api/v1/apps/rocket-crew/catalogue-entry", rcKey, rocket);
    await approve("rocket-crew");
    const games = await catalogueIds();
    expect(games.map((g) => g.appId)).toEqual(CATALOGUE.map((g) => g.appId));
    expect(games[0]).toMatchObject({ appId: "rocket-crew", name: "Rocket Crew II" });
  });

  it("CATALOGUE_START_URLS still points a game at a local server, live entries included", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    await approve("comet-catch");
    const games = await catalogueIds({
      CATALOGUE_START_URLS: JSON.stringify({
        "comet-catch": "http://localhost:9001/",
        "bake-shop": "http://localhost:9002/",
      }),
    });
    expect(games.find((g) => g.appId === "comet-catch")?.startUrl).toBe("http://localhost:9001/");
    expect(games.find((g) => g.appId === "bake-shop")?.startUrl).toBe("http://localhost:9002/");
  });

  it("a rejected entry stays out, with the admin's note in its status", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    const r = await reject("comet-catch", "The TV page shows a QR code when framed");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ appId: "comet-catch", status: "rejected" });
    expect((await catalogueIds()).map((g) => g.appId)).not.toContain("comet-catch");
    const status = obj((await call("GET", ENTRY, ccKey)).body);
    expect(status).toMatchObject({
      status: "rejected",
      note: "The TV page shows a QR code when framed",
    });
    expect(typeof status.reviewedAt).toBe("number");
  });

  it("rejecting an update leaves the live entry live", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    await approve("comet-catch");
    await call("PUT", ENTRY, ccKey, { ...COMET, name: "Comet Catch Deluxe" });
    await reject("comet-catch", "Not yet");
    expect((await catalogueIds()).find((g) => g.appId === "comet-catch")?.name).toBe("Comet Catch");
    const status = obj((await call("GET", ENTRY, ccKey)).body);
    expect(status.status).toBe("rejected");
    expect(obj(status.live).name).toBe("Comet Catch");
  });

  it("a rejection needs a note", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    const r = await reject("comet-catch", undefined);
    expect(r.status).toBe(400);
    expect(errorCode(r.body)).toBe("invalid_body");
  });

  it("there is nothing to review without a pending submission", async () => {
    expect((await approve("comet-catch")).status).toBe(404);
    expect(errorCode((await approve("comet-catch")).body)).toBe("nothing_pending");
    await call("PUT", ENTRY, ccKey, COMET);
    await approve("comet-catch");
    expect(errorCode((await approve("comet-catch")).body)).toBe("nothing_pending");
    expect(errorCode((await reject("comet-catch", "x")).body)).toBe("nothing_pending");
  });

  it("needs the admin token; with none configured everything is refused", async () => {
    await call("PUT", ENTRY, ccKey, COMET);
    expect((await approve("comet-catch", null)).status).toBe(401);
    expect(errorCode((await approve("comet-catch", "wrong")).body)).toBe("unauthorized");
    expect(errorCode((await approve("comet-catch", ccKey)).body)).toBe("unauthorized");
    const unset = await approve("comet-catch", ADMIN, {});
    expect(unset.status).toBe(401);
    expect(errorCode(unset.body)).toBe("unauthorized");
    expect(obj((await call("GET", ENTRY, ccKey)).body).status).toBe("pending");
  });

  it("the deployed app mounts the review and the entry routes too", async () => {
    const res = await app.request(
      ENTRY,
      { headers: { Authorization: `Bearer ${ccKey}` } },
      { DB: d1.db, OGS_JWT_SECRET: "x" },
    );
    expect(res.status).toBe(200);
    const admin = await app.request(
      "/api/v1/admin/catalogue-entries/comet-catch/approve",
      { method: "POST" },
      { DB: d1.db, OGS_JWT_SECRET: "x" },
    );
    expect(admin.status).toBe(401);
  });
});
