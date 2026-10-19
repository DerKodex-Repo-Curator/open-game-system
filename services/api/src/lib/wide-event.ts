import type { Context } from "hono";

/**
 * Wide events (docs/agents/observability.md): one structured line per unit of work (an HTTP
 * request, a couch session action, a container lifecycle step). The object itself goes to the
 * console so Workers Logs indexes its fields: `console.info` when it went well, `console.error`
 * with `error: { type, message, stack }` when it failed. sre-agent groups error lines by
 * "error.type: error.message", so messages stay stable and ids go in fields.
 *
 * Kids use OGS: never put display names, emails, tokens or typed text in an event. `scrub` is the
 * backstop for error text, not the plan.
 */

export const SERVICE = "opengame-api";

export type ErrorFields = { type: string; message: string; stack?: string };

/** Context fields a unit of work adds: ids, counts, flags, enum values. */
export type EventFields = Record<string, unknown> & { error?: ErrorFields };

export type WideEvent = EventFields & {
  event: string;
  service: string;
  version: string;
  source: "server";
  outcome: "ok" | "error";
};

const MAX_TEXT = 2000;

/** Takes emails, JWTs, token= values, bearer tokens, private keys and game keys out of a string. */
export function scrub(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[private key]",
    )
    .replace(/ogsk_[\w-]+/g, "ogsk_REDACTED")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "REDACTED")
    .replace(/([?&#]token=)[^&#\s"]+/gi, "$1REDACTED")
    .replace(/(Bearer\s+)[^\s"]+/gi, "$1REDACTED")
    .slice(0, MAX_TEXT);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** An error's class (or a stable stand-in) and scrubbed message and stack. */
export function errorFields(error: unknown): ErrorFields {
  if (error instanceof Error) {
    const fields: ErrorFields = { type: error.name || "Error", message: scrub(error.message) };
    if (error.stack) fields.stack = scrub(error.stack);
    return fields;
  }
  if (typeof error === "string") return { type: "Error", message: scrub(error) };
  return { type: "NonError", message: scrub(stringify(error)) };
}

/** The deployed version (the CF_VERSION_METADATA binding), or "dev" without it. */
export function versionOf(env: { CF_VERSION_METADATA?: { id: string } } | undefined): string {
  return env?.CF_VERSION_METADATA?.id ?? "dev";
}

/** Writes one wide event: core fields win over context fields of the same name. */
export function emit(
  event: string,
  version: string,
  fields: EventFields,
  outcome: "ok" | "error" = fields.error ? "error" : "ok",
): WideEvent {
  const line: WideEvent = {
    ...fields,
    event,
    service: SERVICE,
    version,
    source: "server",
    outcome,
  };
  if (outcome === "error") console.error(line);
  else console.info(line);
  return line;
}

// --- The request's event, enriched by whatever handles it -----------------------------------

const requestEvents = new WeakMap<Request, EventFields>();

/** Starts the request's event (the wide-event middleware). */
export function beginRequestEvent(request: Request): EventFields {
  const fields: EventFields = {};
  requestEvents.set(request, fields);
  return fields;
}

/**
 * The current request's event, to add context to (ids, counts, flags). Outside the middleware
 * (a sub-app in a unit test) it is a detached object nobody emits.
 */
export function requestEvent(c: Context): EventFields {
  return requestEvents.get(c.req.raw) ?? beginRequestEvent(c.req.raw);
}

/** A failure the handler caught and answered itself (a 5xx): the line carries its error. */
export function recordError(c: Context, error: unknown): void {
  requestEvent(c).error = errorFields(error);
}
