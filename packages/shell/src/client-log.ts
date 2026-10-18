import { z } from "zod";

/**
 * The app's structured client log: one JSON "wide event" per step, batched and POSTed to the
 * API (POST /api/v1/client-events), which writes each as a line in Workers Logs. Offline, events
 * wait in memory (at most MAX_BUFFER, oldest dropped); on background the app flushes and keeps
 * what it could not send for the next launch. Never logs a token: token= values and JWT-looking
 * strings are redacted and secret-named keys dropped before anything leaves the phone; device ids
 * go in hashed (hashId).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogValue = string | number | boolean | null;
export type LogData = Record<string, LogValue | undefined>;

export type ClientLogContext = {
  app: "mobile" | "receiver";
  build?: string;
  version?: string;
  platform?: string;
  profileId?: string;
  sessionId?: string;
  deviceHash?: string;
};

export type ClientEvent = {
  name: string;
  at: number;
  level: LogLevel;
  attemptId?: string;
  durationMs?: number;
  error?: string;
  /** The error's class (`TypeError`) or a domain name (`UnhandledRejection`): sre-agent's type. */
  errorType?: string;
  errorStack?: string;
  data?: Record<string, LogValue>;
};

export type EventFields = {
  level?: LogLevel;
  attemptId?: string;
  durationMs?: number;
  /** An Error (its message) or a string; makes the level "error" unless one is given. */
  error?: unknown;
  /** With an error: its type and stack (js-errors.ts sets them for uncaught errors). */
  errorType?: string;
  errorStack?: string;
  data?: LogData;
};

export interface ClientLog {
  event(name: string, fields?: EventFields): void;
  /** Sends what's buffered (one flush at a time). */
  flush(): Promise<void>;
  /** The app went to the background: flush, and store what couldn't be sent. */
  background(): Promise<void>;
  /** At launch: what the last run couldn't send goes first. */
  restore(): Promise<void>;
}

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const STORAGE_KEY = "@ogs/client-log";
export const MAX_BUFFER = 500;
const MAX_STRING = 1000;
const SECRET_KEY = /token|secret|password|authorization|cookie/i;

/** Takes token= query values and JWT-looking strings out of a string. */
export function redact(text: string): string {
  return text
    .replace(/([?&#]token=)[^&#\s"]+/gi, "$1REDACTED")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "REDACTED");
}

const clean = (s: string) => redact(s).slice(0, MAX_STRING);

function cleanData(data: LogData | undefined): Record<string, LogValue> | undefined {
  if (!data) return undefined;
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || SECRET_KEY.test(key)) continue;
    out[key] = typeof value === "string" ? clean(value) : value;
  }
  return out;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** FNV-1a, two seeds: a stable 64-bit hash of a device id (not reversible to the id at a glance). */
export function hashId(id: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `h:${fnv(0x811c9dc5)}${fnv(0x01000193 ^ 0x5bd1e995)}`;
}

let attempts = 0;
/** A correlation id for one cast attempt (castToTv, switchTv, a stop). */
export function newAttemptId(): string {
  attempts = (attempts + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${attempts}`;
}

const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const StoredSchema = z.array(
  z.object({
    context: z.object({
      app: z.enum(["mobile", "receiver"]),
      build: z.string().optional(),
      version: z.string().optional(),
      platform: z.string().optional(),
      profileId: z.string().optional(),
      sessionId: z.string().optional(),
      deviceHash: z.string().optional(),
    }),
    event: z.object({
      name: z.string(),
      at: z.number(),
      level: z.enum(["debug", "info", "warn", "error"]),
      attemptId: z.string().optional(),
      durationMs: z.number().optional(),
      error: z.string().optional(),
      errorType: z.string().optional(),
      errorStack: z.string().optional(),
      data: z.record(z.string(), Scalar).optional(),
    }),
  }),
);

type Entry = { context: ClientLogContext; event: ClientEvent };

export function createClientLog(deps: {
  send(batch: { context: ClientLogContext; events: ClientEvent[] }): Promise<boolean>;
  context(): ClientLogContext;
  now(): number;
  storage?: Storage;
  schedule?: (fn: () => void, ms: number) => () => void;
  batchSize?: number;
  flushMs?: number;
}): ClientLog {
  const batchSize = deps.batchSize ?? 50;
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  let buffer: Entry[] = [];
  let pending: (() => void) | null = null;
  let inFlight: Promise<void> | null = null;

  const add = (entries: Entry[], front = false) => {
    buffer = front ? [...entries, ...buffer] : [...buffer, ...entries];
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(buffer.length - MAX_BUFFER);
  };

  /** The next batch: consecutive events with the same context, at most batchSize. */
  const nextBatch = (): Entry[] => {
    if (buffer.length === 0) return [];
    const key = JSON.stringify(buffer[0].context);
    let n = 0;
    while (n < buffer.length && n < batchSize && JSON.stringify(buffer[n].context) === key) n++;
    return buffer.slice(0, n);
  };

  async function drain() {
    for (let batch = nextBatch(); batch.length > 0; batch = nextBatch()) {
      const ok = await deps
        .send({ context: batch[0].context, events: batch.map((e) => e.event) })
        .catch(() => false);
      if (!ok) return;
      buffer = buffer.slice(batch.length);
    }
  }

  function flush(): Promise<void> {
    pending?.();
    pending = null;
    // A flush asked for while one runs goes after it (events may have come in meanwhile).
    const run = (): Promise<void> => {
      inFlight = drain().finally(() => {
        inFlight = null;
      });
      return inFlight;
    };
    return inFlight ? inFlight.then(() => (inFlight ? inFlight : run())) : run();
  }

  return {
    event(name, fields = {}) {
      const error = fields.error === undefined ? undefined : clean(errorMessage(fields.error));
      const event: ClientEvent = {
        name,
        at: deps.now(),
        level: fields.level ?? (error === undefined ? "info" : "error"),
      };
      if (fields.attemptId) event.attemptId = fields.attemptId;
      if (fields.durationMs !== undefined) event.durationMs = Math.max(0, fields.durationMs);
      if (error !== undefined) event.error = error;
      if (error !== undefined && fields.errorType) event.errorType = fields.errorType.slice(0, 80);
      if (error !== undefined && fields.errorStack) event.errorStack = clean(fields.errorStack);
      const data = cleanData(fields.data);
      if (data) event.data = data;
      add([{ context: { ...deps.context() }, event }]);
      if (buffer.length >= batchSize) void flush();
      else if (!pending)
        pending = schedule(() => {
          pending = null;
          void flush();
        }, deps.flushMs ?? 5000);
    },
    flush,
    async background() {
      await flush();
      if (!deps.storage) return;
      if (buffer.length > 0) await deps.storage.setItem(STORAGE_KEY, JSON.stringify(buffer));
      else await deps.storage.removeItem(STORAGE_KEY);
    },
    async restore() {
      if (!deps.storage) return;
      const raw = await deps.storage.getItem(STORAGE_KEY).catch(() => null);
      await deps.storage.removeItem(STORAGE_KEY).catch(() => {});
      if (!raw) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const stored = StoredSchema.safeParse(parsed);
      if (stored.success) add(stored.data, true);
    },
  };
}

/**
 * Sends a batch to POST /api/v1/client-events with the profile token. True when the batch is
 * done with: sent, or refused for good (400, 413: the same batch can never succeed). False keeps
 * it for later: no profile yet, offline, 401, 429, 5xx.
 */
export function clientEventsSender(deps: {
  baseUrl: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  auth: () => { token: string } | null;
}) {
  return async (batch: { context: ClientLogContext; events: ClientEvent[] }): Promise<boolean> => {
    const auth = deps.auth();
    if (!auth) return false;
    const res = await deps.fetch(`${deps.baseUrl}/api/v1/client-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(batch),
    });
    return res.ok || res.status === 400 || res.status === 413;
  };
}

/** A log that drops everything (tests, and code that runs before the app's log exists). */
export const noLog: ClientLog = {
  event() {},
  flush: async () => {},
  background: async () => {},
  restore: async () => {},
};
