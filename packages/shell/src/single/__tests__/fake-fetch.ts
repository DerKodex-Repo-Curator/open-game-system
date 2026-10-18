/** A fetch that answers from a route table and records every call (tests only). */
export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export type FakeAnswer = { status: number; body?: unknown } | Error;
type Route = (call: FakeCall) => FakeAnswer | Promise<FakeAnswer>;

export function fakeFetch(routes: Record<string, Route>) {
  const calls: FakeCall[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw && !Array.isArray(raw) && !(raw instanceof Headers)) Object.assign(headers, raw);
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method, url, headers, body };
    calls.push(call);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const route = routes[`${method} ${path}`];
    const answer = route
      ? await route(call)
      : { status: 404, body: { error: { code: "not_found", message: path, status: 404 } } };
    if (answer instanceof Error) throw answer;
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
    });
  };
  return { fetch, calls };
}
