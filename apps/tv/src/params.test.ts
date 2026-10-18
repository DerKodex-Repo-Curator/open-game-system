import { describe, expect, it } from "vitest";
import { frameTimeoutMs, launcherSessionOf, parseParams, viewTimeoutMs, wsUrl } from "./params";

const b64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${b64url(JSON.stringify(payload))}.sig`;
const LAUNCHER = jwt({ sub: "host", did: "tv-1", kind: "launcher", sid: "s1", exp: 9999999999 });

describe("launcher URL", () => {
  it("parses a live launcher URL and reads its session from the token", () => {
    expect(parseParams(`?api=https://api.opengame.org&token=${LAUNCHER}`)).toEqual({
      ok: true,
      params: { mode: "live", api: "https://api.opengame.org", token: LAUNCHER, sessionId: "s1" },
    });
  });

  it("rejects a token that isn't a launcher token", () => {
    expect(parseParams("?api=https://api.opengame.org&token=abc").ok).toBe(false);
    const phone = jwt({ sub: "p1", did: "d1", kind: "phone", exp: 9 });
    expect(parseParams(`?api=https://api.opengame.org&token=${phone}`).ok).toBe(false);
  });

  it("runs fake mode without api or token", () => {
    expect(parseParams("?fake=1")).toEqual({ ok: true, params: { mode: "fake", hold: false } });
    expect(parseParams("?fake=1&hold=1")).toEqual({
      ok: true,
      params: { mode: "fake", hold: true },
    });
  });

  it("runs fake mode on a fresh couch (nothing played yet) when asked", () => {
    expect(parseParams("?fake=1&world=fresh")).toEqual({
      ok: true,
      params: { mode: "fake", hold: false, fresh: true },
    });
    expect(parseParams("?fake=1&world=other")).toEqual({
      ok: true,
      params: { mode: "fake", hold: false },
    });
  });

  it("rejects a missing token or a bad api", () => {
    expect(parseParams("?api=https://x.org").ok).toBe(false);
    expect(parseParams(`?api=not a url&token=${LAUNCHER}`).ok).toBe(false);
    expect(parseParams("").ok).toBe(false);
  });

  it("strips a trailing slash from the api base", () => {
    const r = parseParams(`?api=http://localhost:8787/&token=${LAUNCHER}`);
    expect(r.ok && r.params.mode === "live" && r.params.api).toBe("http://localhost:8787");
    const many = parseParams(`?api=http://localhost:8787///&token=${LAUNCHER}`);
    expect(many.ok && many.params.mode === "live" && many.params.api).toBe("http://localhost:8787");
  });

  it("says which params are wrong", () => {
    expect(parseParams("")).toEqual({ ok: false, error: "api, token" });
    expect(parseParams("?api=https://x.org")).toEqual({ ok: false, error: "token" });
    expect(parseParams("?api=https://x.org&token=abc")).toEqual({
      ok: false,
      error: "token: not a launcher token",
    });
  });

  it("only swaps a leading http for ws", () => {
    expect(wsUrl("ftp://http.example", "t")).toBe("ftp://http.example/api/v1/couch/ws?token=t");
  });

  it("builds the couch socket URL from the api base", () => {
    expect(wsUrl("https://api.opengame.org", "a b")).toBe(
      "wss://api.opengame.org/api/v1/couch/ws?token=a%20b",
    );
    expect(wsUrl("http://localhost:8787", "t")).toBe("ws://localhost:8787/api/v1/couch/ws?token=t");
  });
});

describe("session from the launcher token", () => {
  it("reads the sid claim of a launcher token without verifying", () => {
    expect(launcherSessionOf(LAUNCHER)).toBe("s1");
  });

  it("handles base64url payloads", () => {
    expect(
      launcherSessionOf(jwt({ sub: "ü?>>", did: "d", kind: "launcher", sid: "ü?>>", exp: 1 })),
    ).toBe("ü?>>");
  });

  it("decodes both base64url substitutions ('-' and '_')", () => {
    const token = jwt({ sub: "h", did: "d", kind: "launcher", sid: "s???~~~", exp: 1 });
    const payload = token.split(".")[1]!;
    expect(payload).toContain("_");
    expect(payload).toContain("-");
    expect(launcherSessionOf(token)).toBe("s???~~~");
  });

  it("returns null for garbage and for phone or tablet tokens", () => {
    expect(launcherSessionOf("nope")).toBeNull();
    expect(launcherSessionOf("a.b.c")).toBeNull();
    expect(launcherSessionOf(jwt({ did: "x" }))).toBeNull();
    expect(launcherSessionOf(jwt({ sub: "p", did: "d", kind: "tablet", exp: 9 }))).toBeNull();
    expect(launcherSessionOf(jwt({ sub: "p", did: "d", kind: "launcher", exp: 9 }))).toBeNull();
  });
});

describe("frame timeout knob", () => {
  it("defaults to 20 s and accepts a positive override", () => {
    expect(frameTimeoutMs("")).toBe(20_000);
    expect(frameTimeoutMs("?frameTimeout=1500")).toBe(1500);
    expect(frameTimeoutMs("?frameTimeout=-1")).toBe(20_000);
    expect(frameTimeoutMs("?frameTimeout=abc")).toBe(20_000);
  });
});

describe("view timeout knob", () => {
  it("defaults to VIEW_TIMEOUT_MS (20 s) and accepts a positive override", () => {
    expect(viewTimeoutMs("")).toBe(20_000);
    expect(viewTimeoutMs("?viewTimeout=1500")).toBe(1500);
    expect(viewTimeoutMs("?viewTimeout=0")).toBe(20_000);
    expect(viewTimeoutMs("?viewTimeout=-1")).toBe(20_000);
    expect(viewTimeoutMs("?viewTimeout=abc")).toBe(20_000);
    expect(viewTimeoutMs("?frameTimeout=1500")).toBe(20_000);
  });
});

describe("chrome=none: a white-label app casts its game with no launcher around it", () => {
  it("adds chrome { appId } to a live launcher URL", () => {
    expect(parseParams(`?api=https://api.opengame.org&token=${LAUNCHER}&chrome=none&app=rocket-crew`)).toEqual({
      ok: true,
      params: { mode: "live", api: "https://api.opengame.org", token: LAUNCHER, sessionId: "s1", chrome: { appId: "rocket-crew" } },
    });
  });
  it("works in fake mode (design and tests)", () => {
    expect(parseParams("?fake=1&chrome=none&app=rocket-crew")).toEqual({ ok: true, params: { mode: "fake", hold: false, chrome: { appId: "rocket-crew" } } });
  });
  it("needs a valid app id", () => {
    expect(parseParams(`?api=https://api.opengame.org&token=${LAUNCHER}&chrome=none`).ok).toBe(false);
    expect(parseParams(`?api=https://api.opengame.org&token=${LAUNCHER}&chrome=none&app=Not%20An%20Id`).ok).toBe(false);
  });
  it("any other chrome value leaves the launcher as it is", () => {
    expect(parseParams(`?api=https://api.opengame.org&token=${LAUNCHER}&chrome=full&app=rocket-crew`)).toEqual(
      parseParams(`?api=https://api.opengame.org&token=${LAUNCHER}`),
    );
  });
});
