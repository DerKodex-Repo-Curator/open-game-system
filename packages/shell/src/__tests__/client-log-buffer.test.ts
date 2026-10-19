import {
  type ClientEvent,
  type ClientLogContext,
  createClientLog,
  hashId,
  newAttemptId,
  STORAGE_KEY,
} from "../client-log";

type Batch = { context: ClientLogContext; events: ClientEvent[] };

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const calls: string[] = [];
  return {
    items,
    calls,
    storage: {
      getItem: async (key: string) => items.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        calls.push(`set ${key}`);
        items.set(key, value);
      },
      removeItem: async (key: string) => {
        calls.push(`remove ${key}`);
        items.delete(key);
      },
    },
  };
}

function setup(
  opts: {
    batchSize?: number;
    flushMs?: number;
    storage?: ReturnType<typeof memory>["storage"];
  } = {},
) {
  const sent: Batch[] = [];
  const log = createClientLog({
    send: async (batch) => {
      sent.push(batch);
      return true;
    },
    context: () => ({ app: "mobile" }),
    now: () => 1,
    ...opts,
  });
  return { log, sent };
}

afterEach(() => jest.useRealTimers());

describe("hashId and newAttemptId, exactly", () => {
  it("hashes to the same 16 hex digits every time, zero-padded", () => {
    expect(hashId("dev-1")).toBe(hashId("dev-1"));
    expect(hashId("dev-1")).toBe("h:181c8e761748fe13");
    expect(hashId("d30")).toMatch(/^h:0fc1a9d0[0-9a-f]{8}$/);
  });

  it("numbers attempts one by one, with six random characters", () => {
    const a = newAttemptId();
    const b = newAttemptId();
    const counter = (id: string) => Number(id.split("-")[2]);
    expect(counter(b)).toBe((counter(a) + 1) % 1_000_000);
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-z]{6}-\d+$/);
  });
});

describe("an event, exactly", () => {
  it("has no attemptId or data keys when none were given, and a clipped errorType", async () => {
    const { log, sent } = setup();
    log.event("plain");
    log.event("typed", { error: new Error("x"), errorType: "T".repeat(100) });
    await log.flush();
    expect(Object.keys(sent[0]?.events[0] ?? {})).toEqual(["name", "at", "level"]);
    expect(sent[0]?.events[1]?.errorType).toBe("T".repeat(80));
  });
});

describe("batches", () => {
  it("sends batchSize events per request, and flushes at once when the buffer reaches it", async () => {
    const { log, sent } = setup({ batchSize: 2 });
    log.event("1");
    expect(sent).toHaveLength(0);
    log.event("2");
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((b) => b.events.length)).toEqual([2]);
    log.event("3");
    log.event("4");
    log.event("5");
    await log.flush();
    expect(sent.map((b) => b.events.map((e) => e.name))).toEqual([["1", "2"], ["3", "4"], ["5"]]);
  });

  it("waits five seconds by default", async () => {
    jest.useFakeTimers();
    const { log, sent } = setup();
    log.event("x");
    await jest.advanceTimersByTimeAsync(4999);
    expect(sent).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
  });
});

describe("background and restore", () => {
  it("without storage, both are no-ops", async () => {
    const { log } = setup();
    await expect(log.background()).resolves.toBeUndefined();
    await expect(log.restore()).resolves.toBeUndefined();
  });

  it("with nothing left over, background clears what was stored", async () => {
    const mem = memory({ [STORAGE_KEY]: "[]" });
    const { log } = setup({ storage: mem.storage });
    await log.background();
    expect(mem.calls).toEqual([`remove ${STORAGE_KEY}`]);
  });

  it("a stored buffer that isn't JSON, or isn't events, is dropped quietly", async () => {
    for (const raw of ["not json", '{"events":1}']) {
      const mem = memory({ [STORAGE_KEY]: raw });
      const { log, sent } = setup({ storage: mem.storage });
      await expect(log.restore()).resolves.toBeUndefined();
      await log.flush();
      expect(sent).toEqual([]);
      expect(mem.items.has(STORAGE_KEY)).toBe(false);
    }
  });

  it("what the last run kept goes before this run's events", async () => {
    const kept = [{ context: { app: "mobile" }, event: { name: "old", at: 0, level: "info" } }];
    const mem = memory({ [STORAGE_KEY]: JSON.stringify(kept) });
    const { log, sent } = setup({ storage: mem.storage });
    log.event("new");
    await log.restore();
    await log.flush();
    expect(sent.flatMap((b) => b.events.map((e) => e.name))).toEqual(["old", "new"]);
  });
});
