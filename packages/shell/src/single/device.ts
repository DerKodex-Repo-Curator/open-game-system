import type { ShellDevice } from "./guest-profile";
import type { SecureStorage } from "./identity";

export const DEVICE_ID_KEY = "ogs.deviceId";

export interface DeviceSourceDeps {
  storage: SecureStorage;
  /** A new random id (expo-crypto's randomUUID). */
  mintId: () => string;
  kind: () => "phone" | "tablet";
  name: () => string | null;
}

/** This device as the OGS API registers it; its id is minted once and kept in SecureStore. */
export function createDeviceSource(deps: DeviceSourceDeps): () => Promise<ShellDevice> {
  return async () => {
    let deviceId = await deps.storage.getItemAsync(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = deps.mintId();
      await deps.storage.setItemAsync(DEVICE_ID_KEY, deviceId);
    }
    const kind = deps.kind();
    const name = (deps.name() ?? "").trim().slice(0, 60);
    return { deviceId, kind, name: name || (kind === "tablet" ? "Tablet" : "Phone") };
  };
}
