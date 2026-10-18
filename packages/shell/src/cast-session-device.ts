import type { CastDevice } from "./cast-store";

type SessionDevice = { deviceId: string; friendlyName: string } | null;

/**
 * The SESSION_CONNECTED event for a new cast session, named after the device the session is
 * really on (session.getCastDevice()). The discovery list's order says nothing about which one
 * the user picked, so it's only used when there's a single candidate.
 */
export function sessionConnectedEvent(device: SessionDevice, discovered: CastDevice[]) {
  return {
    type: "SESSION_CONNECTED" as const,
    ...sessionDevice(device, discovered),
    sessionId: "cast-session",
    streamSessionId: "",
  };
}

/** The session's own device; else the only one discovered; else a placeholder. */
function sessionDevice(device: SessionDevice, discovered: CastDevice[]) {
  if (device) return { deviceId: device.deviceId, deviceName: device.friendlyName };
  if (discovered.length === 1)
    return { deviceId: discovered[0].id, deviceName: discovered[0].name };
  return { deviceId: "unknown", deviceName: "your TV" };
}
