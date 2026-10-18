import { type ClientLog, type EventFields, newAttemptId, noLog } from "./client-log";

/**
 * The cast lifecycle's log: every cast step is one wide event under `cast.*`, and each cast
 * attempt (a Cast tap, a TV switch, a stop) gets a correlation id that the native session events
 * that follow carry too, so one attempt reads as one story in Workers Logs.
 */
export interface CastTrace {
  /** A new attempt: its id becomes current until the next one. */
  begin(kind: "cast" | "switch" | "stop", data?: EventFields["data"]): string;
  /** The attempt in progress, if any. */
  current(): string | undefined;
  /** A cast.* event, under the current attempt. */
  event(name: string, fields?: EventFields): void;
  now(): number;
}

export function createCastTrace(log: ClientLog, now: () => number = Date.now): CastTrace {
  let attempt: string | undefined;
  const event = (name: string, fields: EventFields = {}) =>
    log.event(`cast.${name}`, { attemptId: attempt, ...fields });
  return {
    begin(kind, data) {
      attempt = newAttemptId();
      event(`${kind}.requested`, { data });
      return attempt;
    },
    current: () => attempt,
    event,
    now,
  };
}

/** A trace that logs nothing (tests, and callers that don't pass one). */
export const noTrace: CastTrace = createCastTrace(noLog);
