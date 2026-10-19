/**
 * Lets a timer stop keeping the process alive where timers can (Node, Jest: `unref()`). React
 * Native timers are numbers and are left as they are.
 */
export function unrefTimer(timer: unknown): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    if (typeof timer.unref === "function") timer.unref();
  }
}

/**
 * setTimeout for background work (a game token refresh due in an hour): it never keeps a process
 * alive on its own (unrefTimer).
 */
export function backgroundTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms);
  unrefTimer(timer);
  return timer;
}
