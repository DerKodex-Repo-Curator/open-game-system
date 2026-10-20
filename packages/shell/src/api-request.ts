import type { Instance } from "@open-game-system/ogs-protocol";
import { z } from "zod";
import { failureOf, jsonRequestInit, responseJson } from "./http-json";

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
    const token = init.authed ? profileToken() : undefined;
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, jsonRequestInit(init, token));
    } catch (err) {
      throw new OgsApiError("OFFLINE", `Can't reach OGS: ${String(err)}`, 0);
    }
    const json = await responseJson(res);
    if (!res.ok) {
      const { code, message, status } = failureOf(res.status, json);
      throw new OgsApiError(code, message, status);
    }
    return json;
  }

  function profileToken(): string {
    const id = auth();
    if (!id) throw new OgsApiError("NO_PROFILE", "This device has no OGS profile yet", 0);
    return id.token;
  }

  function parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const r = schema.safeParse(data);
    if (!r.success) throw new OgsApiError("BAD_RESPONSE", r.error.message, 0);
    return r.data;
  }

  return { request, parse };
}
