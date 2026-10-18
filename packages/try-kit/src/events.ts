const REF = /^[a-z0-9_-]{1,32}$/;

/** Where a visitor came from (`?ref=hn` on the shared link): a short lowercase slug, else null. */
export function parseRef(raw: string | null | undefined): string | null {
  const ref = raw?.toLowerCase() ?? "";
  return REF.test(ref) ? ref : null;
}

/**
 * One wide event: a flat object with its name. `console.log(JSON.stringify(wideEvent(...)))` in a
 * Worker or Durable Object lands in Workers Logs, so rounds played by referrer are a log query.
 * Put no names or ids beyond the room code in it.
 */
export function wideEvent<T extends Record<string, string | number | boolean | null>>(event: string, fields: T): { event: string } & T {
  return { event, ...fields };
}
