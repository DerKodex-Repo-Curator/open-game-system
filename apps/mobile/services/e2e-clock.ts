/**
 * End-to-end tests only: the second-visit e2e (docs/acceptance/2026-10-18-second-visit.feature)
 * reopens the app "the next day" by moving its clock forward. Detox passes the offset as the launch
 * argument ogsClockOffsetMs; services/e2e-clock-install.ts reads it only in builds made with
 * EXPO_PUBLIC_E2E_CLOCK=1, so store builds never shift their clock.
 */
export function clockOffset(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^-?\d+$/.test(raw)
        ? Number(raw)
        : 0;
  return Number.isSafeInteger(n) ? n : 0;
}

/** Date.now() runs `offsetMs` ahead until the returned function puts it back. */
export function shiftClock(offsetMs: number): () => void {
  const real = Date.now;
  if (offsetMs === 0) return () => {};
  Date.now = () => real() + offsetMs;
  return () => {
    Date.now = real;
  };
}
