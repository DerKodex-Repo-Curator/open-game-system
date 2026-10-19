/**
 * One Cast at a time (the TV tab's Cast, the cast prompt's Cast): a tap while a cast is running
 * shares that cast's outcome instead of starting another. Two starts at once is what Google Cast
 * refuses ("a session currently established"), and each would make its own couch session. The
 * remote's TV picker has its own guard, where the last tap wins (cast-switch.ts).
 */
export function createCastOnce<T>() {
  let running: Promise<T> | null = null;
  return {
    run(cast: () => Promise<T>): Promise<T> {
      if (running) return running;
      const p = cast().finally(() => {
        if (running === p) running = null;
      });
      running = p;
      return p;
    },
  };
}
