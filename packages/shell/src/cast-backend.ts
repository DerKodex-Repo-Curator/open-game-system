import type { CastDevice } from "./cast-store";
import type { SessionManagerLike } from "./cast-sync";

/** Everything the app needs from a cast implementation: real Google Cast, or the simulator fake. */
export interface CastBackend {
  sessionManager: SessionManagerLike;
  startDiscovery(): void;
  getDevices(): CastDevice[];
  subscribeDevices(listener: (devices: CastDevice[]) => void): () => void;
  showCastDialog(): void;
}
