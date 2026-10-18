const MONTH_S = 31 * 24 * 3600;

/** The board is behind SCOREBOARD_KEY: a link carries ?key=, which becomes a cookie. */
export function access(req: Request, key: string): { ok: false } | { ok: true; setCookie: string | null } {
  if (key.length < 16) return { ok: false };
  const given = new URL(req.url).searchParams.get("key");
  if (given === key) return { ok: true, setCookie: `sb=${key}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MONTH_S}` };
  const cookie = (req.headers.get("Cookie") ?? "").split(/;\s*/).find((c) => c.startsWith("sb="));
  return cookie?.slice(3) === key ? { ok: true, setCookie: null } : { ok: false };
}
