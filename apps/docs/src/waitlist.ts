import { z } from "zod";

/**
 * The developer waitlist behind /on-tv (bet 4): POST /api/waitlist stores a signup, POST /api/visit
 * counts a landing-page view per UTM source. Pages Functions in functions/api/ call these with the
 * D1 binding. No IP addresses or user agents are stored.
 */

/** The slice of D1 the handlers use (a D1Database fits). */
export interface Db {
  prepare(sql: string): {
    bind(...values: (string | null)[]): { run(): Promise<{ meta: { changes: number } }> };
  };
}

export const ENGINES = ["phaser", "three", "pixi", "canvas", "react", "godot-web", "other"] as const;

const Tag = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => v || null);

const Source = z.object({
  utm_source: Tag,
  utm_medium: Tag,
  utm_campaign: Tag,
  ref: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
});

const SignupSchema = Source.extend({
  email: z.string().trim().toLowerCase().email().max(254),
  building: z.string().trim().max(500).optional().default(""),
  engine: z
    .string()
    .optional()
    .transform((v) => (ENGINES.find((e) => e === v) ?? null)),
  /** Hidden from people; bots fill it. */
  website: z.string().optional(),
});

const VisitSchema = Source.extend({ path: z.string().trim().min(1).max(200) });

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data"))
    return Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
  return JSON.parse(await request.text());
}

const apiError = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message, status } }, { status });

const wantsHtml = (request: Request) =>
  (request.headers.get("accept") ?? "").includes("text/html");

const back = (query: string) =>
  new Response(null, { status: 303, headers: { location: `/on-tv?${query}#join` } });

export async function handleSignup(
  request: Request,
  db: Db,
  now: () => Date = () => new Date(),
): Promise<Response> {
  const html = wantsHtml(request);
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return html ? back("error=email") : apiError("bad_request", "Body must be JSON or a form", 400);
  }
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success)
    return html ? back("error=email") : apiError("invalid_email", "That email address doesn't look right", 400);
  const s = parsed.data;
  if (!s.website) {
    await db
      .prepare(
        `INSERT INTO waitlist (email, building, engine, utm_source, utm_medium, utm_campaign, referrer, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`,
      )
      .bind(s.email, s.building, s.engine, s.utm_source, s.utm_medium, s.utm_campaign, s.ref, now().toISOString())
      .run();
  }
  return html ? back("joined=1") : Response.json({ ok: true });
}

export async function handleVisit(
  request: Request,
  db: Db,
  now: () => Date = () => new Date(),
): Promise<Response> {
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return apiError("bad_request", "Body must be JSON", 400);
  }
  const parsed = VisitSchema.safeParse(body);
  if (!parsed.success) return apiError("bad_request", "Not a visit", 400);
  const v = parsed.data;
  await db
    .prepare(
      `INSERT INTO visits (path, utm_source, utm_medium, utm_campaign, referrer, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(v.path, v.utm_source, v.utm_medium, v.utm_campaign, v.ref, now().toISOString())
    .run();
  return new Response(null, { status: 204 });
}
