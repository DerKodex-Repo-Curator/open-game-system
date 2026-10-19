import type { CastDevice } from "../../../services/cast-store";

export type StoppedTv = { id: string; name: string };

/**
 * The TV this phone just stopped casting to, so the TV tab can say "Stopped casting on <TV>" and
 * offer Cast again to that same TV in one tap. Lives for the app's run; casting again clears it.
 */
export function createLastStop() {
  let current: StoppedTv | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    get: (): StoppedTv | null => current,
    stopped(tv: StoppedTv) {
      current = tv;
      emit();
    },
    clear() {
      if (!current) return;
      current = null;
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const lastStop = createLastStop();

/**
 * The Cast button's TV: the one you picked, else the one you just stopped, else the one this phone
 * cast to last (kept across launches), else the first found.
 */
export function castTarget(
  devices: CastDevice[],
  picked: CastDevice | null,
  stopped: StoppedTv | null,
  last: StoppedTv | null = null,
): CastDevice | null {
  if (picked) return picked;
  const again = stopped ? devices.find((d) => d.id === stopped.id) : undefined;
  const before = last ? devices.find((d) => d.id === last.id) : undefined;
  return again ?? before ?? devices[0] ?? null;
}
