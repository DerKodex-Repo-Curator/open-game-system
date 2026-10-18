/**
 * opengame.org's link files with every registered white-label app (ADR 2026-10-18-multi-tenant-push):
 * the OGS API builds them (GET /api/v1/apps/apple-app-site-association, /assetlinks.json); these
 * functions pass them through. If the API can't answer, the static files in public/.well-known (the
 * OGS app's own entries) are served instead, so the OGS app's links never break.
 */
const DEFAULT_API = "https://opengame-api.jonathanrmumm.workers.dev";

type Context = { env: { OGS_API?: string }; next: () => Promise<Response> };

export async function passThrough(
  ctx: Context,
  file: "apple-app-site-association" | "assetlinks.json",
): Promise<Response> {
  try {
    const res = await fetch(`${ctx.env.OGS_API ?? DEFAULT_API}/api/v1/apps/${file}`);
    const body = res.ok ? await res.text() : "";
    if (!body.startsWith("{") && !body.startsWith("[")) return ctx.next();
    return new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
    });
  } catch {
    return ctx.next();
  }
}
