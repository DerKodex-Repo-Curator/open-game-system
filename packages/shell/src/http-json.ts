import { z } from "zod";

/**
 * The JSON request/response steps shared by the OGS API clients (api-request's OgsApiError and
 * api-client's ShellApiError): the request init, the body read, and the failure an error answer
 * names. Internal: not re-exported from the package entry.
 */

export type ApiFailure = { code: string; message: string; status: number };

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), status: z.number() }),
});

/** JSON in: Accept always, Content-Type with a body, the token as `Authorization: Bearer`. */
export function jsonRequestInit(
  init: { method?: string; body?: unknown },
  token: string | undefined,
): RequestInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return {
    method: init.method ?? "GET",
    headers,
    // Stryker disable next-line ConditionalExpression: equivalent, JSON.stringify(undefined) is undefined
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  };
}

/** A response's body as JSON: null when it is empty or not JSON. */
export async function responseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Why a request failed: the API's `{ error }` body, else HTTP_<status>. */
export function failureOf(status: number, json: unknown): ApiFailure {
  const parsed = ErrorBodySchema.safeParse(json);
  if (parsed.success) return parsed.data.error;
  return { code: `HTTP_${status}`, message: `OGS answered ${status}`, status };
}
