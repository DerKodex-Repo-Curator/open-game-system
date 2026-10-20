import { createApiRequest, OgsApiError } from "../api-request";

async function failure(promise: Promise<unknown>): Promise<OgsApiError> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof OgsApiError)) throw new Error(`not an OgsApiError: ${String(error)}`);
  return error;
}

describe("createApiRequest, edges", () => {
  it("names its errors OgsApiError and says when OGS can't be reached", async () => {
    const { request } = createApiRequest({
      baseUrl: "https://api.test",
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
      auth: () => null,
    });
    const error = await failure(request("/x"));
    expect(error.name).toBe("OgsApiError");
    expect(error.message).toBe("Can't reach OGS: TypeError: Network request failed");
  });

  it("an authed request before the device has a profile says so", async () => {
    const { request } = createApiRequest({
      baseUrl: "https://api.test",
      fetch: async () => new Response(null, { status: 204 }),
      auth: () => null,
    });
    const error = await failure(request("/x", { authed: true }));
    expect([error.code, error.message]).toEqual([
      "NO_PROFILE",
      "This device has no OGS profile yet",
    ]);
  });
});
