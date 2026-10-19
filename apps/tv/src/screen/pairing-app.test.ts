import { describe, expect, it } from "vitest";
import { createPairing, screenLauncherParams } from "./pairing";

// docs/acceptance/2026-10-18-shell-device-gaps.feature: a white-label app's cast to a browser TV is
// chromeless: the screen shows only that app's TV page (chrome=none&app=<appId>).
const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${b64url(JSON.stringify(payload))}.sig`;
const LAUNCHER = jwt({ sub: "host", did: "tv-1", kind: "launcher", sid: "s1", exp: 9999999999 });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function memory() {
  const data: Record<string, string> = {
    "ogs.screen": JSON.stringify({ screenId: "sc1", secret: "k".repeat(43) }),
  };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

describe("a screen showing a white-label app's cast", () => {
  it("the pairing view carries the app", async () => {
    const p = createPairing({
      api: "https://api.test",
      fetch: async () =>
        json(200, { code: "NT9WPH", show: { token: LAUNCHER, app: "rocket-crew" } }),
      storage: memory(),
    });
    await p.tick();
    expect(p.view()).toEqual({ kind: "launcher", token: LAUNCHER, app: "rocket-crew" });
  });

  it("the OGS app's cast has no app (unchanged)", async () => {
    const p = createPairing({
      api: "https://api.test",
      fetch: async () => json(200, { code: "NT9WPH", show: { token: LAUNCHER } }),
      storage: memory(),
    });
    await p.tick();
    expect(p.view()).toEqual({ kind: "launcher", token: LAUNCHER });
  });

  it("boots the launcher chromeless for that app, or whole without one", () => {
    expect(
      screenLauncherParams("https://api.test", {
        kind: "launcher",
        token: LAUNCHER,
        app: "rocket-crew",
      }),
    ).toEqual({
      mode: "live",
      api: "https://api.test",
      token: LAUNCHER,
      sessionId: "s1",
      chrome: { appId: "rocket-crew" },
    });
    expect(screenLauncherParams("https://api.test", { kind: "launcher", token: LAUNCHER })).toEqual(
      {
        mode: "live",
        api: "https://api.test",
        token: LAUNCHER,
        sessionId: "s1",
      },
    );
  });

  it("a token that isn't a launcher's boots nothing", () => {
    expect(
      screenLauncherParams("https://api.test", { kind: "launcher", token: "x.y.z" }),
    ).toBeNull();
  });
});
