import type { Instance } from "@open-game-system/ogs-protocol";
import { z } from "zod";

/**
 * The OGS API's request and parse, shared by every OGS API client (apps/mobile's ogs-api and
 * friends-api, the shell's game-profile and push-api). Every response is parsed at the boundary;
 * `fetch` is injected so tests need no server.
 */

export class OgsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OgsApiError";
  }
}

/** A profile: what games and friends see. `handle` is the @id without the "@". */
export const ProfileSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  name: z.string().min(1),
  sticker: z.string().min(1),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const LoginSchema = z.object({
  provider: z.enum(["apple", "google", "email"]),
  email: z.string().nullable(),
});
export type Login = z.infer<typeof LoginSchema>;
export type Provider = Login["provider"];

/** What proves a login: a provider's ID token, or an email and the 6-digit code sent to it. */
export type Credential =
  | { provider: "apple"; idToken: string }
  | { provider: "google"; idToken: string }
  | { provider: "email"; email: string; code: string };

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), status: z.number() }),
});

export type InstanceSource = Exclude<Instance["source"], "server">;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OgsApiOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** This device's token for its profile, or null before it has one. */
  auth: () => { token: string } | null;
}

/**
 * The API's request and parse: JSON in and out, the profile token when `authed`, and every failure
 * as an OgsApiError (OFFLINE, the API's error code, or BAD_RESPONSE). Shared by every client
 * (apps/mobile's ogs-api and friends-api, the shell's game-profile and push-api).
 */
export function createApiRequest({ baseUrl, fetch, auth }: OgsApiOptions) {
  async function request(
    path: string,
    init: { method?: string; body?: unknown; authed?: boolean } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.authed) {
      const id = auth();
      if (!id) throw new OgsApiError("NO_PROFILE", "This device has no OGS profile yet", 0);
      headers.Authorization = `Bearer ${id.token}`;
    }
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      throw new OgsApiError("OFFLINE", `Can't reach OGS: ${String(err)}`, 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const parsed = ErrorBodySchema.safeParse(json);
      if (parsed.success) {
        const { code, message, status } = parsed.data.error;
        throw new OgsApiError(code, message, status);
      }
      throw new OgsApiError(`HTTP_${res.status}`, `OGS answered ${res.status}`, res.status);
    }
    return json;
  }

  function parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const r = schema.safeParse(data);
    if (!r.success) throw new OgsApiError("BAD_RESPONSE", r.error.message, 0);
    return r.data;
  }

  return { request, parse };
}
