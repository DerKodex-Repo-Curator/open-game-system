import { describe, expect, it } from "vitest";
import { checkManifest, frameable, type Probe } from "../src/lib/manifest-check";

/**
 * ogs manifest check, the API side (docs/design-docs/ogs-cli.md, POST /api/v1/manifests/check):
 * schema issues, catalogue warnings and the live checks, with the network replaced by a probe.
 */
const GOOD = {
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

const answer =
  (status: number, headers: Record<string, string> = {}): Probe =>
  async () => ({ status, headers: new Headers(headers) });
const offline: Probe = async () => null;
const codes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code);

describe("checkManifest", () => {
  it("a valid manifest whose pages answer and can be framed has no issues or warnings", async () => {
    const urls: string[] = [];
    const r = await checkManifest(GOOD, async (url) => {
      urls.push(url);
      return { status: 200, headers: new Headers() };
    });
    expect(r).toEqual({
      valid: true,
      issues: [],
      warnings: [],
      checked: { startUrl: 200, tvUrl: 200, frameable: true },
    });
    expect(urls).toEqual(["https://comet.example/", "https://comet.example/tv"]);
  });

  it("names schema issues by their path and runs no live checks", async () => {
    let probed = false;
    const { startUrl: _s, ...noStart } = GOOD;
    const r = await checkManifest(
      { ...noStart, roles: [{ id: "x", label: "X", audience: "dog" }] },
      async () => {
        probed = true;
        return null;
      },
    );
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.path)).toEqual(["startUrl", "roles.0.audience"]);
    expect(r.issues.every((i) => i.message.length > 0)).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.checked).toEqual({});
    expect(probed).toBe(false);
  });

  it("a body that isn't an object is one issue at the root", async () => {
    const r = await checkManifest("nope", offline);
    expect(r.valid).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].path).toBe("");
  });

  it("warns about an http startUrl, a missing art kit and no kid role", async () => {
    const r = await checkManifest(
      {
        ...GOOD,
        startUrl: "http://comet.example/",
        roles: [
          { id: "a", label: "A", audience: "grownup" },
          { id: "b", label: "B", audience: "little" },
        ],
        art: { tile: "https://comet.example/art/tile.jpg", icon: "https://comet.example/i.png" },
      },
      answer(200),
    );
    expect(r.valid).toBe(true);
    expect(codes(r)).toEqual(["start_url_not_https", "missing_art", "no_kid_role"]);
    expect(r.warnings.find((w) => w.code === "missing_art")?.message).toContain(
      "cover, logo, heroClean",
    );
  });

  it("a game with no roles has no kid role", async () => {
    expect(codes(await checkManifest({ ...GOOD, roles: [] }, answer(200)))).toEqual([
      "no_kid_role",
    ]);
  });

  it("a grown-ups' game (every role a grown-up) needs no kid role", async () => {
    const r = await checkManifest(
      { ...GOOD, roles: [{ id: "a", label: "A", audience: "grownup" }] },
      answer(200),
    );
    expect(codes(r)).toEqual([]);
  });

  it.each([404, 500])("a start URL answering %i is unreachable", async (status) => {
    const r = await checkManifest({ ...GOOD, tvUrl: undefined }, answer(status));
    expect(codes(r)).toEqual(["start_url_unreachable"]);
    expect(r.checked).toEqual({ startUrl: status });
  });

  it("a redirect counts as reachable", async () => {
    const r = await checkManifest({ ...GOOD, tvUrl: undefined }, answer(302));
    expect(codes(r)).toEqual([]);
    expect(r.checked).toEqual({ startUrl: 302 });
  });

  it("no answer at all (timeout, DNS) is unreachable, and the TV page can't be judged", async () => {
    const r = await checkManifest(GOOD, offline);
    expect(codes(r)).toEqual(["start_url_unreachable"]);
    expect(r.checked).toEqual({});
  });

  it("a TV page that forbids framing is named", async () => {
    const r = await checkManifest(GOOD, async (url) => ({
      status: 200,
      headers: new Headers(url.endsWith("/tv") ? { "X-Frame-Options": "DENY" } : {}),
    }));
    expect(codes(r)).toEqual(["tv_page_not_frameable"]);
    expect(r.checked).toEqual({ startUrl: 200, tvUrl: 200, frameable: false });
  });

  it("a room game with no tvUrl gets no TV check", async () => {
    const r = await checkManifest({ ...GOOD, tvUrl: undefined }, answer(200));
    expect(r.checked).toEqual({ startUrl: 200 });
  });
});

describe("frameable (by the OGS launcher)", () => {
  const h = (headers: Record<string, string>) => frameable(new Headers(headers));
  it.each([
    [{}, true],
    [{ "X-Frame-Options": "DENY" }, false],
    [{ "X-Frame-Options": "sameorigin" }, false],
    [{ "X-Frame-Options": "ALLOW-FROM https://tv.opengame.org" }, true],
    [{ "Content-Security-Policy": "frame-ancestors 'none'" }, false],
    [{ "Content-Security-Policy": "frame-ancestors 'self'" }, false],
    [
      {
        "Content-Security-Policy":
          "default-src 'self'; frame-ancestors 'self' https://*.opengame.org",
      },
      true,
    ],
    [{ "Content-Security-Policy": "frame-ancestors https://tv.opengame.org" }, true],
    [{ "Content-Security-Policy": "frame-ancestors tv.opengame.org" }, true],
    [{ "Content-Security-Policy": "frame-ancestors *" }, true],
    [{ "Content-Security-Policy": "frame-ancestors https:" }, true],
    [{ "Content-Security-Policy": "frame-ancestors http:" }, false],
    [{ "Content-Security-Policy": "frame-ancestors https://other.example" }, false],
    [{ "Content-Security-Policy": "frame-ancestors https://*.opengame.org.evil.example" }, false],
    [{ "Content-Security-Policy": "default-src 'self'" }, true],
    // CSP frame-ancestors overrides X-Frame-Options in browsers that support it.
    [
      {
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors https://*.opengame.org",
      },
      true,
    ],
  ])("%j → %s", (headers, expected) => {
    expect(h(headers)).toBe(expected);
  });
});
