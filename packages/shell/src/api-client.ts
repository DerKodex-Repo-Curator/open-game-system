import type { z } from "zod";
import type { FetchLike } from "./api-request";
import { failureOf, jsonRequestInit, responseJson } from "./http-json";

/**
 * The single-game shell's OGS API request: JSON in and out, an optional device token, every
 * failure as a ShellApiError (OFFLINE, the API's error code, HTTP_<status>, BAD_RESPONSE), every
 * answer parsed with a zod schema at this boundary.
 */
export class ShellApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ShellApiError";
  }
}

export interface ShellApiOptions {
  /** e.g. https://api.opengame.org */
  baseUrl: string;
  fetch: FetchLike;
}

export interface RequestInitLite {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** A device token, sent as `Authorization: Bearer`. */
  token?: string;
}

export type ShellRequest = <T>(
  schema: z.ZodType<T>,
  path: string,
  init?: RequestInitLite,
) => Promise<T>;

export function createShellRequest({ baseUrl, fetch }: ShellApiOptions): ShellRequest {
  const base = baseUrl.replace(/\/+$/, "");
  return async (schema, path, init = {}) => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, jsonRequestInit(init, init.token || undefined));
    } catch (err) {
      throw new ShellApiError("OFFLINE", `Can't reach OGS: ${String(err)}`, 0);
    }
    const json = await responseJson(res);
    if (!res.ok) {
      const { code, message, status } = failureOf(res.status, json);
      throw new ShellApiError(code, message, status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ShellApiError("BAD_RESPONSE", parsed.error.message, 0);
    return parsed.data;
  };
}
