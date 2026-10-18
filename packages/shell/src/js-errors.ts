import type { ClientLog } from "./client-log";

/**
 * Uncaught JS errors into the client log (docs/agents/observability.md): React Native's global
 * handler (ErrorUtils), unhandled promise rejections (Hermes' rejection tracker) and the app's
 * error boundary. Each becomes one error event with `errorType` and `errorStack`; the global
 * handler's is sent at once (the app may be about to die). On the device a crash loop is capped:
 * 3 of one error per launch, 20 errors a minute.
 *
 * Native crashes kill the process before JS runs and are not seen here (see the native-crash
 * proposal in docs/agents/observability.md).
 */

export type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

export type RejectionTracker = (options: {
  allRejections: boolean;
  onUnhandled: (id: number, reason: unknown) => void;
  onHandled: (id: number) => void;
}) => void;

export const PER_ERROR = 3;
export const PER_MINUTE = 20;

function typeOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.name ? error.name : fallback;
}

export function captureJsErrors(
  log: ClientLog,
  deps: {
    errorUtils: { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void };
    /** Hermes' enablePromiseRejectionTracker, when there is one (release builds). */
    trackRejections?: RejectionTracker | null;
    now?: () => number;
  },
) {
  const now = deps.now ?? Date.now;
  const seen = new Map<string, number>();
  let windowStart = now();
  let inWindow = 0;

  /** Whether this error may be logged (the device-side caps). */
  const allow = (type: string, message: string): boolean => {
    const key = `${type}: ${message}`;
    const count = seen.get(key) ?? 0;
    if (count >= PER_ERROR) return false;
    if (now() - windowStart > 60_000) {
      windowStart = now();
      inWindow = 0;
    }
    if (inWindow >= PER_MINUTE) return false;
    seen.set(key, count + 1);
    inWindow++;
    return true;
  };

  const report = (
    name: string,
    error: unknown,
    fallbackType: string,
    data: Record<string, string | boolean>,
  ): boolean => {
    const type = typeOf(error, fallbackType);
    const message = error instanceof Error ? error.message : String(error);
    if (!allow(type, message)) return false;
    log.event(name, {
      error,
      errorType: type,
      errorStack: error instanceof Error ? error.stack : undefined,
      data,
    });
    return true;
  };

  const previous = deps.errorUtils.getGlobalHandler();
  deps.errorUtils.setGlobalHandler((error, isFatal) => {
    if (report("app.js_error", error, "Error", { fatal: isFatal === true })) void log.flush();
    previous(error, isFatal);
  });

  deps.trackRejections?.({
    allRejections: true,
    onUnhandled: (_id, reason) => {
      report("app.unhandled_rejection", reason, "UnhandledRejection", {});
    },
    onHandled: () => {},
  });

  return {
    /** The error boundary caught a render error (componentDidCatch). */
    boundary(error: unknown, boundary: string) {
      report("app.render_error", error, "Error", { boundary });
    },
  };
}
