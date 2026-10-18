/**
 * How long a stream may run. The TV receiver's heartbeat keeps this (GPU) server up; if a cast is
 * forgotten, that would bill all night. Past maxMs the server ends the stream and refuses
 * heartbeats, so the pings stop and Cloud Run can scale to zero.
 */
export function createStreamLifetime({
  maxMs,
  now = Date.now,
}: {
  maxMs: number;
  now?: () => number;
}) {
  let startedAt: number | null = null;
  return {
    started() {
      startedAt = now();
    },
    stopped() {
      startedAt = null;
    },
    expired(): boolean {
      return startedAt !== null && now() - startedAt > maxMs;
    },
  };
}

/**
 * OGS cast contract: a streamed game page may keep `window.__ogsActivityAt` (ms since epoch) at the
 * time players last did something. If it's been quiet for longer than idleMs, the cast is abandoned
 * (the TV was left on) and the stream should end. Pages that don't report are never "idle" here.
 */
export function isIdle(activityAt: unknown, now: number, idleMs: number): boolean {
  return typeof activityAt === "number" && Number.isFinite(activityAt) && now - activityAt > idleMs;
}
