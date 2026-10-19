jest.mock("react-native-google-cast", () => {
  const discovery = {
    onDevicesUpdated: jest.fn(),
    startDiscovery: jest.fn(),
    getDevices: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      getDiscoveryManager: () => discovery,
      getSessionManager: () => ({}),
      showCastDialog: jest.fn(async () => true),
    },
  };
});

import GoogleCast from "react-native-google-cast";
import type { CastTrace } from "../cast-trace";
import type { EventFields } from "../client-log";
import { createGoogleCastBackend } from "../google-cast-backend";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Google Cast backend: what it logs", () => {
  it("logs a discovery that fails to start as discovery.failed at warn", async () => {
    const error = new Error("no local network permission");
    jest.mocked(GoogleCast.getDiscoveryManager().startDiscovery).mockRejectedValueOnce(error);
    const events: { name: string; fields?: EventFields }[] = [];
    const trace: CastTrace = {
      begin: () => "attempt-1",
      current: () => undefined,
      event: (name, fields) => void events.push({ name, fields }),
      now: () => 0,
    };
    createGoogleCastBackend(trace).startDiscovery();
    await flush();
    expect(events).toEqual([
      { name: "discovery.started", fields: undefined },
      { name: "discovery.failed", fields: { error, level: "warn" } },
    ]);
  });
});
