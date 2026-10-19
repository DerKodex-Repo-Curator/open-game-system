import type { ClientLog, EventFields } from "../client-log";
import { captureJsErrors, type GlobalHandler, type RejectionTracker } from "../js-errors";

function setup(opts: { start?: number; trackRejections?: RejectionTracker | null } = {}) {
  const events: { name: string; fields: EventFields | undefined }[] = [];
  let flushes = 0;
  const log: ClientLog = {
    event: (name, fields) => events.push({ name, fields }),
    flush: async () => {
      flushes++;
    },
    background: async () => {},
    restore: async () => {},
  };
  let handler: GlobalHandler = () => {};
  let t = opts.start ?? 0;
  const capture = captureJsErrors(log, {
    errorUtils: {
      getGlobalHandler: () => () => {},
      setGlobalHandler: (h) => {
        handler = h;
      },
    },
    trackRejections: opts.trackRejections,
    now: () => t,
  });
  return {
    capture,
    events,
    flushes: () => flushes,
    throwGlobal: (error: unknown, isFatal?: boolean) => handler(error, isFatal),
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe("captureJsErrors, edges", () => {
  it("an Error with no name is typed by its source", () => {
    const s = setup();
    const nameless = new Error("boom");
    nameless.name = "";
    s.capture.boundary(nameless, "Game");
    expect(s.events[0]?.fields?.errorType).toBe("Error");
  });

  it("a thrown string is an Error, not fatal unless said so", () => {
    const s = setup();
    s.throwGlobal("boom");
    expect(s.events[0]?.fields).toEqual(
      expect.objectContaining({ errorType: "Error", data: { fatal: false } }),
    );
    s.capture.boundary("render boom", "Game");
    expect(s.events[1]?.fields?.errorType).toBe("Error");
  });

  it("the minute window opens a minute after the first error, not at the minute", () => {
    const s = setup({ start: 100_000 });
    for (let i = 0; i < 20; i++) s.throwGlobal(new Error(`e${i}`));
    expect(s.events).toHaveLength(20);
    s.at(100_001);
    s.throwGlobal(new Error("too soon"));
    s.at(160_000);
    s.throwGlobal(new Error("still the same minute"));
    expect(s.events).toHaveLength(20);
    s.at(160_001);
    s.throwGlobal(new Error("next minute"));
    expect(s.events).toHaveLength(21);
  });

  it("an error over the cap is not flushed", () => {
    const s = setup();
    for (let i = 0; i < 3; i++) s.throwGlobal(new Error("same"));
    expect(s.flushes()).toBe(3);
    s.throwGlobal(new Error("same"));
    expect(s.flushes()).toBe(3);
  });

  it("works without a rejection tracker", () => {
    expect(() => setup({ trackRejections: undefined })).not.toThrow();
    expect(() => setup({ trackRejections: null })).not.toThrow();
  });

  it("asks the tracker for every rejection", () => {
    const options: Parameters<RejectionTracker>[0][] = [];
    setup({ trackRejections: (o) => options.push(o) });
    expect(options[0]?.allRejections).toBe(true);
  });
});
