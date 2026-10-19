/**
 * Registers this phone for pushes under its OGS profile's device id (how OGS finds a profile's
 * phones), as soon as the profile exists, and again when the device id changes. Keeps the token
 * listener for that device id.
 */
export function startPushRegistration(deps: {
  deviceId: () => string | null;
  subscribe: (listener: () => void) => () => void;
  register: (deviceId: string) => Promise<unknown>;
  listen: (deviceId: string) => { remove(): void };
}): () => void {
  let current: string | null = null;
  let listener: { remove(): void } | null = null;

  const follow = () => {
    const id = deps.deviceId();
    if (id === current) return;
    listener?.remove();
    listener = null;
    current = id;
    if (id === null) return;
    deps
      .register(id)
      .catch((err: unknown) => console.warn("[Notifications] Push registration failed:", err));
    listener = deps.listen(id);
  };

  const unsubscribe = deps.subscribe(follow);
  follow();
  return () => {
    unsubscribe();
    listener?.remove();
    listener = null;
  };
}
