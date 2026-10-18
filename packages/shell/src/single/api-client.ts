import { z } from "zod";

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

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

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

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), status: z.number() }),
});

export type ShellRequest = <T>(
  schema: z.ZodType<T>,
  path: string,
  init?: RequestInitLite,
) => Promise<T>;

export function createShellRequest({ baseUrl, fetch }: ShellApiOptions): ShellRequest {
  const base = baseUrl.replace(/\/+$/, "");
  return async (schema, path, init = {}) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      throw new ShellApiError("OFFLINE", `Can't reach OGS: ${String(err)}`, 0);
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
        throw new ShellApiError(code, message, status);
      }
      throw new ShellApiError(`HTTP_${res.status}`, `OGS answered ${res.status}`, res.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ShellApiError("BAD_RESPONSE", parsed.error.message, 0);
    return parsed.data;
  };
}
