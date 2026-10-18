import { describe, expect, it } from "vitest";
import { createPairing, type PairingView, screenParams } from "./pairing";

// Acceptance: 2026-10-17-browser-tv.feature. The TV page with no launcher link is a screen: it
// shows a code until a phone casts to it, then the launcher; stop puts the code back.

const PROD = "https://opengame-api.jonathanrmumm.workers.dev";

describe("which TV pages are screens", () => {
  it("a bare page is a screen on the production API", () => {
    expect(screenParams("")).toEqual({ api: PROD });
    expect(screenParams("?")).toEqual({ api: PROD });
  });

  it("?screen=1 names another API (local runs)", () => {
    expect(screenParams("?screen=1&api=http://127.0.0.1:8868/")).toEqual({
      api: "http://127.0.0.1:8868",
    });
  });

  it("a launcher link or fake mode is not a screen", () => {
    expect(screenParams("?api=https://x.org&token=t")).toBeNull();
    expect(screenParams("?fake=1")).toBeNull();
    expect(screenParams("?api=https://x.org")).toBeNull();
    expect(screenParams("?screen=1&api=not a url")).toBeNull();
  });
});

type Call = { method: string; url: string; secret?: string };
function fakeApi(script: { create?: () => Response; state?: (call: number) => Response }) {
  const calls: Call[] = [];
  let states = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? "GET",
      url,
      secret: headers.get("X-Screen-Secret") ?? undefined,
    });
    if ((init?.method ?? "GET") === "POST")
      return (
        script.create?.() ?? json(201, { screenId: "sc1", code: "NT9WPH", secret: "s".repeat(43) })
      );
    return script.state?.(states++) ?? json(200, { code: "NT9WPH", show: null });
  };
  return { calls, fetch };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function memory(start: Record<string, string> = {}) {
  const data = { ...start };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

async function run(p: ReturnType<typeof createPairing>, ticks: number): Promise<PairingView[]> {
  const seen: PairingView[] = [p.view()];
  p.subscribe(() => seen.push(p.view()));
  for (let i = 0; i < ticks; i++) await p.tick();
  return seen;
}

describe("a screen pairing", () => {
  it("makes a screen, keeps its secret in the browser, and shows its code", async () => {
    const api = fakeApi({});
    const storage = memory();
    const p = createPairing({ api: "https://api.test", fetch: api.fetch, storage });
    await run(p, 1);
    expect(p.view()).toEqual({ kind: "code", code: "NT9WPH" });
    expect(api.calls[0]).toEqual({ method: "POST", url: "https://api.test/api/v1/screens" });
    expect(JSON.parse(storage.data["ogs.screen"] ?? "{}")).toEqual({
      screenId: "sc1",
      secret: "s".repeat(43),
    });
  });

  it("reuses the screen it already is: no new code after a reload", async () => {
    const api = fakeApi({});
    const storage = memory({
      "ogs.screen": JSON.stringify({ screenId: "old", secret: "k".repeat(43) }),
    });
    const p = createPairing({ api: "https://api.test", fetch: api.fetch, storage });
    await run(p, 1);
    expect(api.calls).toEqual([
      { method: "GET", url: "https://api.test/api/v1/screens/old", secret: "k".repeat(43) },
    ]);
    expect(p.view()).toEqual({ kind: "code", code: "NT9WPH" });
  });

  it("a screen the API forgot (expired) is made again", async () => {
    const api = fakeApi({
      state: (n) =>
        n === 0 ? json(404, { error: {} }) : json(200, { code: "KQ7M2X", show: null }),
    });
    const storage = memory({
      "ogs.screen": JSON.stringify({ screenId: "old", secret: "k".repeat(43) }),
    });
    const p = createPairing({ api: "https://api.test", fetch: api.fetch, storage });
    await run(p, 2);
    expect(api.calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
    expect(JSON.parse(storage.data["ogs.screen"] ?? "{}").screenId).toBe("sc1");
  });

  it("shows the launcher once a phone casts, and its code again when it stops", async () => {
    const shows = [null, { token: "lt-1" }, { token: "lt-1" }, null];
    const api = fakeApi({ state: (n) => json(200, { code: "NT9WPH", show: shows[n] ?? null }) });
    const p = createPairing({ api: "https://api.test", fetch: api.fetch, storage: memory() });
    const seen = await run(p, 5);
    expect(seen).toEqual([
      { kind: "starting" },
      { kind: "code", code: "NT9WPH" },
      { kind: "launcher", token: "lt-1" },
      { kind: "code", code: "NT9WPH" },
    ]);
  });

  it("says it can't reach OGS, and keeps trying", async () => {
    let up = false;
    const fetch = async (url: string, init?: RequestInit) => {
      if (!up) throw new TypeError("Failed to fetch");
      return fakeApi({}).fetch(url, init);
    };
    const p = createPairing({ api: "https://api.test", fetch, storage: memory() });
    await p.tick();
    expect(p.view()).toEqual({ kind: "offline" });
    up = true;
    await p.tick();
    expect(p.view()).toEqual({ kind: "code", code: "NT9WPH" });
  });

  it("a failed poll mid-game keeps the launcher up (only the phone's stop takes it down)", async () => {
    let n = 0;
    const fetch = async (url: string, init?: RequestInit) => {
      n++;
      if (n === 3) throw new TypeError("Failed to fetch");
      return fakeApi({ state: () => json(200, { code: "NT9WPH", show: { token: "lt-1" } }) }).fetch(
        url,
        init,
      );
    };
    const p = createPairing({ api: "https://api.test", fetch, storage: memory() });
    await p.tick();
    expect(p.view()).toEqual({ kind: "launcher", token: "lt-1" });
    await p.tick();
    expect(p.view()).toEqual({ kind: "launcher", token: "lt-1" });
  });

  it("ignores an answer that isn't a screen", async () => {
    const api = fakeApi({ create: () => json(201, { nope: true }) });
    const p = createPairing({ api: "https://api.test", fetch: api.fetch, storage: memory() });
    await p.tick();
    expect(p.view()).toEqual({ kind: "offline" });
  });
});
