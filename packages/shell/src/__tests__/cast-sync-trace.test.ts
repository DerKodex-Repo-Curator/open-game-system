jest.mock("react-native-google-cast", () => ({
  __esModule: true,
  default: { showCastDialog: jest.fn() },
}));

import { createCastStore } from "../cast-store";
import { castCommands, type SessionManagerLike, startCastSync } from "../cast-sync";
import type { CastTrace } from "../cast-trace";
import { type EventFields, hashId } from "../client-log";

// The cast.* events the session sync writes: a cast's story in Workers Logs reads from these.

type Device = { deviceId: string; friendlyName: string };

function recordingTrace() {
  const events: { name: string; fields?: EventFields }[] = [];
  const trace: CastTrace = {
    begin: () => "attempt-1",
    current: () => undefined,
    event: (name, fields) => void events.push({ name, fields }),
    now: () => 0,
  };
  return { trace, events };
}

function session(getCastDevice: () => Promise<Device | null>) {
  return {
    getCastDevice,
    addChannel: async () => ({ sendMessage: async () => {}, onMessage: () => {} }),
  };
}

type Session = ReturnType<typeof session>;

function sessionManager(current: () => Promise<Session | null> = async () => null) {
  const started = new Set<(s: Session) => void>();
  const resumed = new Set<(s: Session) => void>();
  const ended = new Set<(s?: unknown, e?: string | null) => void>();
  const sub = <T>(set: Set<T>, fn: T) => {
    set.add(fn);
    return { remove: () => void set.delete(fn) };
  };
  const none = { remove: () => {} };
  const sm: SessionManagerLike = {
    getCurrentCastSession: current,
    startSession: async () => true,
    endCurrentSession: async () => {},
    onSessionStarting: () => none,
    onSessionStarted: (f) => sub(started, f),
    onSessionStartFailed: () => none,
    onSessionSuspended: () => none,
    onSessionResumed: (f) => sub(resumed, f),
    onSessionEnded: (f) => sub(ended, f),
  };
  return {
    sm,
    start: (s: Session) => {
      for (const f of started) f(s);
    },
    resume: (s: Session) => {
      for (const f of resumed) f(s);
    },
    end: (error?: string) => {
      for (const f of ended) f(undefined, error);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const named = (events: { name: string; fields?: EventFields }[], name: string) =>
  events.filter((e) => e.name === name).map((e) => e.fields);

function setup(current?: () => Promise<Session | null>) {
  const { trace, events } = recordingTrace();
  const manager = sessionManager(current);
  const commands = castCommands(() => {}, trace);
  const store = createCastStore(commands);
  const stop = startCastSync(store, manager.sm, commands, "https://stream.example", trace);
  return { ...manager, commands, store, events, stop };
}

describe("cast sync: what it logs", () => {
  it("marks a session's device lookup that lands after the session ended as stale, and ignores it", async () => {
    const { start, end, store, events } = setup();
    let answer: (d: Device) => void = () => {};
    start(session(() => new Promise<Device>((resolve) => (answer = resolve))));
    end();
    answer({ deviceId: "cc-1", friendlyName: "Living Room" });
    await flush();
    expect(named(events, "session.connected")).toEqual([
      { level: "warn", data: { tv: hashId("cc-1"), stale: true } },
    ]);
    expect(store.getSnapshot().session.status).not.toBe("connected");
  });

  it("logs the current session's device lookup at info, without a stale mark", async () => {
    const { start, events } = setup();
    start(session(async () => ({ deviceId: "cc-1", friendlyName: "Living Room" })));
    await flush();
    expect(named(events, "session.connected")).toEqual([
      { level: "info", data: { tv: hashId("cc-1") } },
    ]);
  });

  it("logs a resumed session and a clean end", async () => {
    const { resume, end, events } = setup();
    resume(session(async () => null));
    end();
    await flush();
    expect(events.map((e) => e.name)).toEqual(
      expect.arrayContaining(["session.resumed", "session.ended"]),
    );
    expect(named(events, "session.ended")).toEqual([{}]);
  });

  it("logs a session that ended with an error at warn", async () => {
    const { start, end, events } = setup();
    start(session(async () => null));
    end("network lost");
    await flush();
    expect(named(events, "session.ended")).toEqual([{ error: "network lost", level: "warn" }]);
  });

  it("logs a failed lookup of the session already running", async () => {
    const error = new Error("no cast context");
    const { events } = setup(async () => {
      throw error;
    });
    await flush();
    expect(named(events, "session.lookup_failed")).toEqual([{ error, level: "warn" }]);
  });

  it("logs a refused start with the error and the hashed TV, and a refused stop with its error", async () => {
    const { trace, events } = recordingTrace();
    const startError = new Error("busy");
    const stopError = new Error("gone");
    const commands = castCommands(() => {}, trace);
    commands.bind({
      ...sessionManager().sm,
      startSession: async () => {
        throw startError;
      },
      endCurrentSession: async () => {
        throw stopError;
      },
    });
    commands.startCasting("cc-1", [{ id: "cc-1", name: "Living Room", type: "chromecast" }]);
    commands.stopCasting();
    await flush();
    expect(named(events, "game_start.rejected")).toEqual([
      { error: startError, data: { tv: hashId("cc-1") } },
    ]);
    expect(named(events, "game_stop.rejected")).toEqual([{ error: stopError }]);
  });
});
