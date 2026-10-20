import { type ClientEvent, createClientLog, errorMessage } from "../client-log";

describe("errorMessage, edges", () => {
  it("an object is its JSON", () => {
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });

  it("undefined is 'undefined'", () => {
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("an object JSON can't write is its string", () => {
    const loop: { self?: unknown } = {};
    loop.self = loop;
    expect(errorMessage(loop)).toBe("[object Object]");
  });
});

describe("createClientLog, edges", () => {
  afterEach(() => jest.useRealTimers());

  function setup() {
    const sent: ClientEvent[][] = [];
    const log = createClientLog({
      send: async (batch) => {
        sent.push(batch.events);
        return true;
      },
      context: () => ({ app: "mobile" }),
      now: () => 1,
      flushMs: 1000,
    });
    return { log, sent };
  }

  it("leaves out data fields that are undefined", async () => {
    const { log, sent } = setup();
    log.event("x", { data: { gone: undefined, kept: 1 } });
    await log.flush();
    expect(Object.keys(sent[0]?.[0]?.data ?? {})).toEqual(["kept"]);
  });

  it("sends on its own timer when nothing flushes it", async () => {
    jest.useFakeTimers();
    const { log, sent } = setup();
    log.event("x");
    await jest.advanceTimersByTimeAsync(999);
    expect(sent).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
  });

  it("a flush cancels the timer: the next event waits its own full delay", async () => {
    jest.useFakeTimers();
    const { log, sent } = setup();
    log.event("a");
    await log.flush();
    expect(sent).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(500);
    log.event("b");
    await jest.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(2);
  });
});
