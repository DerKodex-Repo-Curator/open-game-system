import { z } from "zod";
import { createShellRequest, ShellApiError } from "../api-client";

const answer = (status: number, body: string | null) => async () => new Response(body, { status });

async function failure(promise: Promise<unknown>): Promise<ShellApiError> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof ShellApiError)) throw new Error(`not a ShellApiError: ${String(error)}`);
  return error;
}

describe("createShellRequest, edges", () => {
  it("names its errors ShellApiError", async () => {
    const request = createShellRequest({ baseUrl: "https://api.test", fetch: answer(500, null) });
    expect((await failure(request(z.null(), "/x"))).name).toBe("ShellApiError");
  });

  it("an error answer that isn't JSON is HTTP_<status>, saying what OGS answered", async () => {
    const request = createShellRequest({
      baseUrl: "https://api.test",
      fetch: answer(502, "<html>Bad gateway</html>"),
    });
    const error = await failure(request(z.null(), "/x"));
    expect([error.code, error.message, error.status]).toEqual([
      "HTTP_502",
      "OGS answered 502",
      502,
    ]);
  });

  it("an answer that isn't JSON doesn't parse as anything", async () => {
    const request = createShellRequest({ baseUrl: "https://api.test", fetch: answer(200, "ok") });
    expect((await failure(request(z.string(), "/x"))).code).toBe("BAD_RESPONSE");
    await expect(request(z.null(), "/x")).resolves.toBeNull();
  });

  it("offline says it can't reach OGS, and why", async () => {
    const request = createShellRequest({
      baseUrl: "https://api.test",
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
    });
    const error = await failure(request(z.null(), "/x"));
    expect(error.message).toBe("Can't reach OGS: TypeError: Network request failed");
  });

  it("drops every trailing slash of the base URL", async () => {
    const urls: string[] = [];
    const request = createShellRequest({
      baseUrl: "https://api.test//",
      fetch: async (url) => {
        urls.push(url);
        return new Response(null, { status: 204 });
      },
    });
    await request(z.null(), "/api/v1/x");
    expect(urls).toEqual(["https://api.test/api/v1/x"]);
  });

  it("sends no body without one", async () => {
    const bodies: unknown[] = [];
    const request = createShellRequest({
      baseUrl: "https://api.test",
      fetch: async (_url, init) => {
        bodies.push(init?.body);
        return new Response(null, { status: 204 });
      },
    });
    await request(z.null(), "/x", { method: "POST" });
    expect(bodies).toEqual([undefined]);
  });
});
