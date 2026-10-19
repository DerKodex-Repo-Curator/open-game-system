import type { CastTrace } from "../cast-trace";
import { connectViewChannel, streamServerUrl } from "../cast-view";
import type { EventFields } from "../client-log";

// What the view channel logs (Workers Logs joins TV and phone by these): the reason a LOAD_VIEW was
// skipped or sent, how long it took, and the view's host without its query (the launcher token).

function recordingTrace(times: number[] = []) {
  const events: { name: string; fields?: EventFields }[] = [];
  const trace: CastTrace = {
    begin: () => "attempt-1",
    current: () => undefined,
    event: (name, fields) => void events.push({ name, fields }),
    now: () => times.shift() ?? 0,
  };
  return { trace, events };
}

function channelSession(send: (message: unknown) => Promise<void> = async () => {}) {
  return {
    addChannel: async () => ({
      sendMessage: send,
      onMessage: () => {},
    }),
  };
}

const eventsNamed = (events: { name: string; fields?: EventFields }[], name: string) =>
  events.filter((e) => e.name === name).map((e) => e.fields);

describe("cast view channel: what it logs", () => {
  it("drops every trailing slash from the stream server URL", () => {
    expect(streamServerUrl({ EXPO_PUBLIC_OGS_STREAM: "https://stream.example//" }, "")).toBe(
      "https://stream.example",
    );
  });

  it("logs a skipped LOAD_VIEW with its reason when there is no view yet", async () => {
    const { trace, events } = recordingTrace();
    const channel = await connectViewChannel(channelSession(), () => null, "https://s", trace);
    await channel?.send();
    expect(eventsNamed(events, "load_view.skipped")).toEqual([
      { level: "warn", data: { reason: "connect" } },
      { level: "warn", data: { reason: "change" } },
    ]);
  });

  it("logs a sent LOAD_VIEW with its duration and the view's host only", async () => {
    const { trace, events } = recordingTrace([100, 130]);
    await connectViewChannel(
      channelSession(),
      () => "https://tv.example.com/room?token=secret",
      "https://s",
      trace,
    );
    expect(eventsNamed(events, "load_view.sent")).toEqual([
      { durationMs: 30, data: { host: "tv.example.com", reason: "connect" } },
    ]);
  });

  it("logs a failed LOAD_VIEW with its error and duration", async () => {
    const { trace, events } = recordingTrace([200, 250]);
    const error = new Error("receiver gone");
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await connectViewChannel(
      channelSession(async () => {
        throw error;
      }),
      () => "https://tv.example.com/room",
      "https://s",
      trace,
    );
    warn.mockRestore();
    expect(eventsNamed(events, "load_view.failed")).toEqual([
      { error, durationMs: 50, data: { host: "tv.example.com", reason: "connect" } },
    ]);
  });

  it("names the host 'unknown' when the view is not an absolute URL", async () => {
    const { trace, events } = recordingTrace();
    await connectViewChannel(
      channelSession(),
      () => "see https://tv.example.com/",
      "https://s",
      trace,
    );
    expect(eventsNamed(events, "load_view.sent")).toEqual([
      { durationMs: 0, data: { host: "unknown", reason: "connect" } },
    ]);
  });
});
