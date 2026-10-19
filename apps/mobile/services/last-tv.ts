import { z } from "zod";

/**
 * The TV this phone cast to last, kept across launches: after the app restarts, the Cast button
 * picks it again (docs/acceptance/2026-10-18-second-visit.feature). AsyncStorage in the app.
 */
export const LAST_TV_KEY = "ogs.lastTv";

const LastTvSchema = z.object({ id: z.string().min(1), name: z.string() });
export type LastTv = z.infer<typeof LastTvSchema>;

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function createLastTv(deps: { storage: Storage }) {
  let current: LastTv | null = null;
  let touched = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const ready = deps.storage.getItem(LAST_TV_KEY).then((raw) => {
    let kept: unknown;
    try {
      kept = JSON.parse(raw ?? "");
    } catch {}
    const parsed = LastTvSchema.safeParse(kept);
    // A TV remembered while this loaded is newer than the stored one.
    if (parsed.success && !touched) {
      current = parsed.data;
      emit();
    }
  });
  return {
    ready,
    get: (): LastTv | null => current,
    async remember(tv: LastTv) {
      touched = true;
      if (current?.id === tv.id && current.name === tv.name) return;
      current = tv;
      emit();
      await deps.storage.setItem(LAST_TV_KEY, JSON.stringify(tv));
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type LastTvStore = ReturnType<typeof createLastTv>;

type CastLike = {
  getSnapshot(): {
    session: { status: string; deviceId: string | null; deviceName: string | null };
  };
  subscribe(listener: () => void): () => void;
};

/** Remembers the TV each time a cast connects. */
export function rememberConnectedTv(cast: CastLike, lastTv: Pick<LastTvStore, "remember">) {
  return cast.subscribe(() => {
    const { status, deviceId, deviceName } = cast.getSnapshot().session;
    if (status === "connected" && deviceId)
      void lastTv.remember({ id: deviceId, name: deviceName ?? "" });
  });
}
