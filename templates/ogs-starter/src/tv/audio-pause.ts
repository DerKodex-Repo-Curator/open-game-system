/**
 * Parked means silent (OGS rule): suspend the shared AudioContext on ogs:suspend, and on
 * ogs:resume bring it back only if it was running before.
 */
/** The part of an AudioContext the gate needs (a real AudioContext fits). */
export type Pausable = { state: string; suspend(): Promise<void>; resume(): Promise<void> };

export function createAudioPause(getCtx: () => Pausable | null) {
  let paused = false;
  let parked: Pausable | null = null;
  return {
    setPaused(next: boolean) {
      if (next === paused) return;
      paused = next;
      if (paused) {
        const ctx = getCtx();
        if (ctx?.state === "running") {
          parked = ctx;
          void ctx.suspend();
        }
        return;
      }
      const ctx = parked;
      parked = null;
      if (ctx?.state === "suspended") void ctx.resume();
    },
    paused: () => paused,
  };
}
