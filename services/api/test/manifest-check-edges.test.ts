import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkManifest,
  fetchProbe,
  frameable,
  PROBE_TIMEOUT_MS,
  type Probe,
} from "../src/lib/manifest-check";

/**
 * The manifest check's edges (docs/design-docs/ogs-cli.md, POST /api/v1/manifests/check): the real
 * probe (with fetch stubbed, so nothing reaches the network), the warnings' words, and the CSP
 * frame-ancestors grammar the launcher is checked against.
 */
afterEach(() => vi.unstubAllGlobals());

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

describe("fetchProbe", () => {
  it("GETs once without following redirects, under a 5 s timeout, and cancels the body", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    let cancelled = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      const body = new ReadableStream({
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 302, headers: { Location: "https://x.example/" } });
    });
    const res = await fetchProbe("https://comet.example/");
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("https://x.example/");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://comet.example/");
    expect(seen[0]?.init?.method).toBe("GET");
    expect(seen[0]?.init?.redirect).toBe("manual");
    expect(seen[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(cancelled).toBe(true);
    expect(PROBE_TIMEOUT_MS).toBe(5000);
  });

  it("uses AbortSignal.timeout(5000)", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    expect((await fetchProbe("https://comet.example/"))?.status).toBe(204);
    expect(timeout).toHaveBeenCalledWith(5000);
    timeout.mockRestore();
  });

  it("no answer (a network error or timeout) is null", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchProbe("https://comet.example/")).toBeNull();
  });
});

describe("the live checks' warnings", () => {
  it("an unreachable start URL says what it answered", async () => {
    const r = await checkManifest({ ...GOOD, tvUrl: undefined }, answer(503));
    expect(r.warnings).toEqual([
      { code: "start_url_unreachable", message: "startUrl answered 503" },
    ]);
  });

  it("a start URL that didn't answer says so", async () => {
    const r = await checkManifest({ ...GOOD, tvUrl: undefined }, async () => null);
    expect(r.warnings).toEqual([
      { code: "start_url_unreachable", message: "startUrl didn't answer within 5 s" },
    ]);
  });

  it.each([199, 400])("%i is unreachable", async (status) => {
    expect(
      (await checkManifest({ ...GOOD, tvUrl: undefined }, answer(status))).warnings,
    ).toHaveLength(1);
  });

  it.each([200, 399])("%i is reachable", async (status) => {
    expect((await checkManifest({ ...GOOD, tvUrl: undefined }, answer(status))).warnings).toEqual(
      [],
    );
  });

  it("a TV page the launcher can't frame names the launcher's origin", async () => {
    const r = await checkManifest(GOOD, async (url) => ({
      status: 200,
      headers: new Headers(url.endsWith("/tv") ? { "X-Frame-Options": "SAMEORIGIN" } : {}),
    }));
    expect(r.warnings).toEqual([
      {
        code: "tv_page_not_frameable",
        message:
          "tvUrl's X-Frame-Options or CSP frame-ancestors keeps the OGS launcher (https://tv.opengame.org) from framing it",
      },
    ]);
  });

  it("a TV page that answers an error is still judged for framing", async () => {
    const r = await checkManifest(GOOD, async (url) => ({
      status: url.endsWith("/tv") ? 500 : 200,
      headers: new Headers(),
    }));
    expect(r.checked).toEqual({ startUrl: 200, tvUrl: 500, frameable: true });
  });

  it("the catalogue rules' words", async () => {
    const r = await checkManifest(
      {
        ...GOOD,
        startUrl: "http://comet.example/",
        roles: [{ id: "a", label: "A", audience: "little" }],
        art: { tile: GOOD.art.tile, icon: GOOD.art.icon },
      },
      answer(200),
    );
    expect(r.warnings).toEqual([
      { code: "start_url_not_https", message: "startUrl must be https for the OGS app to open it" },
      { code: "missing_art", message: "The art kit is missing cover, logo, heroClean" },
      {
        code: "no_kid_role",
        message:
          "No role has audience kid (a game for grown-ups gives every role audience grownup)",
      },
    ]);
  });

  it("a mixed game with a kid role, or a grown-ups' game with one grown-up role among others, is fine", async () => {
    const kidOnly = await checkManifest(
      { ...GOOD, roles: [{ id: "k", label: "K", audience: "kid" }] },
      answer(200),
    );
    expect(kidOnly.warnings).toEqual([]);
    const notAllGrownUps = await checkManifest(
      {
        ...GOOD,
        roles: [
          { id: "a", label: "A", audience: "grownup" },
          { id: "b", label: "B", audience: "little" },
        ],
      },
      answer(200),
    );
    expect(notAllGrownUps.warnings.map((w) => w.code)).toEqual(["no_kid_role"]);
  });
});

describe("frame-ancestors source expressions", () => {
  const csp = (sources: string) =>
    frameable(new Headers({ "Content-Security-Policy": `frame-ancestors ${sources}` }));
  it.each([
    ["https://tv.opengame.org/", true],
    ["https://tv.opengame.org//", true],
    ["HTTPS://TV.OPENGAME.ORG", true],
    ["https://tv.opengame.org:443", true],
    ["https://tv.opengame.org:*", true],
    ["https://tv.opengame.org:8443", false],
    ["http://tv.opengame.org", false],
    ["wss://tv.opengame.org", false],
    ["*.opengame.org", true],
    ["https://*.org", true],
    ["https://*.tv.opengame.org", false],
    ["https://opengame.org", false],
    ["https://xtv.opengame.org", false],
    ["https://tv.opengame.org/path", false],
    ["evil.example/https://tv.opengame.org", false],
    ["https://tv.opengame.org.", false],
    ["HTTPS:", true],
    ["wss:", false],
    ["'self' https:", true],
    ["https://bad_host", false],
    ["", false],
  ])("%s → %s", (source, expected) => {
    expect(csp(source)).toBe(expected);
  });

  it("the directive's name is matched in any case, and only frame-ancestors decides", () => {
    expect(frameable(new Headers({ "Content-Security-Policy": "FRAME-ANCESTORS 'none'" }))).toBe(
      false,
    );
    expect(
      frameable(
        new Headers({ "Content-Security-Policy": "default-src *;  frame-ancestors   'none'  " }),
      ),
    ).toBe(false);
    expect(frameable(new Headers({ "Content-Security-Policy": "frame-src 'none'" }))).toBe(true);
  });

  it("X-Frame-Options is read trimmed and in any case", () => {
    expect(frameable(new Headers({ "X-Frame-Options": "  Deny " }))).toBe(false);
    expect(frameable(new Headers({ "X-Frame-Options": "SameOrigin" }))).toBe(false);
    expect(frameable(new Headers())).toBe(true);
  });
});
