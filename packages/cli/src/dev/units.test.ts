import { ManifestSchema } from "@open-game-system/ogs-protocol";
import { describe, expect, it } from "vitest";
import { injectBridge } from "./bridge-script";
import { fakeCouch } from "./couch";
import { type HarnessConfig, harnessHtml } from "./harness";
import { createDevSigner } from "./tokens";

/** The pieces `ogs dev` serves: the fake couch, its key, the harness page, the bridge's place. */
const manifest = ManifestSchema.parse({
  appId: "fixture-game",
  name: "Fixture Game",
  shape: "couch",
  tv: "required",
  startUrl: "http://localhost:5173/play",
  art: { tile: "/tile.png" },
});

const svgOf = (dataUrl: string) =>
  Buffer.from(dataUrl.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");

describe("the fake couch", () => {
  it("six named, coloured players, then the names come round again", () => {
    const couch = fakeCouch(manifest, 7);
    expect(couch.players.map((p) => p.name)).toEqual([
      "Ada",
      "Sam",
      "Rae",
      "Kit",
      "Lou",
      "Ivo",
      "Ada",
    ]);
    expect(couch.players.map((p) => p.handle)).toEqual([
      "ada",
      "sam",
      "rae",
      "kit",
      "lou",
      "ivo",
      "ada",
    ]);
    expect(couch.players.map((p) => /fill="(#[0-9a-f]{6})"/.exec(svgOf(p.avatar))?.[1])).toEqual([
      "#e4572e",
      "#29335c",
      "#f3a712",
      "#669bbc",
      "#4c956c",
      "#9d4edd",
      "#e4572e",
    ]);
  });

  it("an avatar is a disc with the initial", () => {
    const [ada] = fakeCouch(manifest, 1).players;
    expect(ada.avatar.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(svgOf(ada.avatar)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#e4572e"/><text x="32" y="42" font-family="sans-serif" font-size="30" text-anchor="middle" fill="#fff">A</text></svg>',
    );
  });

  it("ids, the session and the sitting share one 8-character run id; players count from 1", () => {
    const couch = fakeCouch(manifest, 2);
    const run = /^dev-couch-([0-9a-f]{8})$/.exec(couch.sid)?.[1];
    expect(run).toBeDefined();
    expect(couch.instanceId).toBe(`dev-sitting-${run}`);
    expect(couch.players.map((p) => p.id)).toEqual([`dev-${run}-1`, `dev-${run}-2`]);
  });

  it("the couch is labelled with the host's name; with no phones, ogs dev", () => {
    expect(fakeCouch(manifest, 2).label).toBe("Ada");
    expect(fakeCouch(manifest, 0).label).toBe("ogs dev");
  });
});

describe("the dev signer", { timeout: 20_000 }, () => {
  it("names its key ogs-dev- and 8 hex characters, and publishes only x and y with it", async () => {
    const [key] = (await createDevSigner()).jwks().keys;
    expect(key.kid).toMatch(/^ogs-dev-[0-9a-f]{8}$/);
    expect(Object.keys(key).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
    expect(key.x.length).toBeGreaterThan(20);
    expect(key.y.length).toBeGreaterThan(20);
  });
});

describe("where the bridge goes", () => {
  it("after <html ...> with attributes, case-insensitively", () => {
    expect(injectBridge('<HTML lang="en"><body>', "S")).toBe('<HTML lang="en">S<body>');
    expect(injectBridge("<html\nlang=en>x", "S")).toBe("<html\nlang=en>Sx");
  });

  it("not after <htmlx> or a tag that only starts like html", () => {
    expect(injectBridge("<htmlx>y", "S")).toBe("S<htmlx>y");
  });

  it("after a doctype that comes after blank space, but not one later in the page", () => {
    expect(injectBridge("  \n<!DOCTYPE html>x", "S")).toBe("  \n<!DOCTYPE html>Sx");
    expect(injectBridge("x<!doctype html>y", "S")).toBe("Sx<!doctype html>y");
  });
});

describe("the harness page", () => {
  const cfg = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
    appId: "fixture-game",
    name: 'Fix & "Go" <Game>',
    tvUrl: null,
    start: {
      type: "ogs:start",
      instanceId: "i",
      mode: "new",
      roster: [],
      token: "t",
      players: [],
    },
    phones: [
      {
        phone: 1,
        name: "Ada's",
        avatar: "data:a",
        url: "http://localhost:1/p?a=1&b=2",
        lanUrl: null,
        lanQr: null,
      },
      {
        phone: 2,
        name: "Sam",
        avatar: "data:s",
        url: "http://localhost:2/p",
        lanUrl: "http://10.0.0.2:2/p",
        lanQr: "data:qr2",
      },
    ],
    startLanUrl: null,
    startLanQr: null,
    jwksUrl: "http://localhost:0/.well-known/jwks.json",
    ...over,
  });

  it("escapes the game's name everywhere it shows", () => {
    const html = harnessHtml(cfg());
    expect(html).toContain("<title>ogs dev: Fix &#38; &#34;Go&#34; &#60;Game&#62;</title>");
    expect(html).toContain(
      "<h1>ogs dev: Fix &#38; &#34;Go&#34; &#60;Game&#62; <code>fixture-game</code></h1>",
    );
  });

  it("one frame per phone, in order", () => {
    const html = harnessHtml(cfg());
    expect(html).toContain(`<div class="phones"><figure class="phone">
  <figcaption><img src="data:a" alt=""> Ada&#39;s</figcaption>
  <iframe id="phone-1" title="Phone 1: Ada&#39;s" src="http://localhost:1/p?a=1&#38;b=2" allow="autoplay; fullscreen; clipboard-write"></iframe>
</figure>
<figure class="phone">
  <figcaption><img src="data:s" alt=""> Sam</figcaption>
  <iframe id="phone-2" title="Phone 2: Sam" src="http://localhost:2/p" allow="autoplay; fullscreen; clipboard-write"></iframe>
</figure></div>`);
  });

  it("a QR code for each phone (and the start URL) on the LAN; none without both", () => {
    const html = harnessHtml(
      cfg({ startLanUrl: "http://10.0.0.2:5173/play", startLanQr: "data:qrs" }),
    );
    expect(html).toContain(
      `<div class="qrs"><figure class="qr"><img src="data:qr2" alt="QR code of http://10.0.0.2:2/p"><figcaption>Sam&#39;s phone (fake OGS app)<br><a href="http://10.0.0.2:2/p">http://10.0.0.2:2/p</a></figcaption></figure><figure class="qr"><img src="data:qrs" alt="QR code of http://10.0.0.2:5173/play"><figcaption>The start URL (plain browser or the OGS app)<br><a href="http://10.0.0.2:5173/play">http://10.0.0.2:5173/play</a></figcaption></figure></div>`,
    );
    const lanUrlOnly = harnessHtml(
      cfg({ startLanUrl: "http://10.0.0.2:5173/play", startLanQr: null }),
    );
    expect(lanUrlOnly).not.toContain("QR code of http://10.0.0.2:5173/play");
    const qrOnly = harnessHtml(cfg({ startLanUrl: null, startLanQr: "data:qrs" }));
    expect(qrOnly).not.toContain('src="data:qrs"');
  });

  it("without the LAN: says so", () => {
    const html = harnessHtml(cfg({ phones: [] }));
    expect(html).toContain(
      '<div class="qrs"><p style="color:var(--dim)">No LAN address found: connect to a network for real phones.</p></div>',
    );
  });

  it("the JWKS URL, and the config for the page's script", () => {
    const html = harnessHtml(cfg());
    expect(html).toContain("<code>OGS_JWKS_URL=http://localhost:0/.well-known/jwks.json</code>");
    const json = /<script id="ogs-dev-config" type="application\/json">([^<]*)<\/script>/.exec(
      html,
    )?.[1];
    expect(JSON.parse(json ?? "null")).toEqual(cfg());
  });
});
