import GoogleCast from "react-native-google-cast";
import type { CastBackend } from "./cast-backend";
import type { CastDevice } from "./cast-store";
import { type CastTrace, noTrace } from "./cast-trace";

/** Real Google Cast behind the CastBackend interface (discovery + session manager + picker). */
export function createGoogleCastBackend(trace: CastTrace = noTrace): CastBackend {
  let devices: CastDevice[] = [];
  const listeners = new Set<(d: CastDevice[]) => void>();
  const discovery = GoogleCast.getDiscoveryManager();
  const publish = (found: { deviceId: string; friendlyName: string }[]) => {
    devices = found.map((d) => ({ id: d.deviceId, name: d.friendlyName, type: "chromecast" }));
    trace.event("discovery.updated", { data: { count: devices.length } });
    for (const l of listeners) l(devices);
  };
  discovery.onDevicesUpdated(publish);
  return {
    sessionManager: GoogleCast.getSessionManager(),
    startDiscovery() {
      trace.event("discovery.started");
      void discovery
        .startDiscovery()
        .then(() => discovery.getDevices())
        .then(publish)
        .catch((err: unknown) => trace.event("discovery.failed", { error: err, level: "warn" }));
    },
    getDevices: () => devices,
    subscribeDevices(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    showCastDialog() {
      void GoogleCast.showCastDialog();
    },
  };
}
