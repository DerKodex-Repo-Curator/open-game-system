import { z } from "zod";
import { createShellRequest, ShellApiError } from "../api-client";
import { fakeFetch } from "./fake-fetch";

const Thing = z.object({ ok: z.literal(true) });

describe("createShellRequest", () => {
  it("sends JSON with a bearer token and parses the answer", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /api/v1/x": () => ({ status: 200, body: { ok: true } }),
    });
    const request = createShellRequest({ baseUrl: "https://api.test", fetch });
    await expect(
      request(Thing, "/api/v1/x", { method: "POST", body: { a: 1 }, token: "tok" }),
    ).resolves.toEqual({ ok: true });
    expect(calls[0]).toEqual({
      method: "POST",
      url: "https://api.test/api/v1/x",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer tok",
      },
      body: { a: 1 },
    });
  });

  it("GET without body or token sends neither", async () => {
    const { fetch, calls } = fakeFetch({ "GET /y": () => ({ status: 200, body: { ok: true } }) });
    await createShellRequest({ baseUrl: "https://api.test", fetch })(Thing, "/y");
    expect(calls[0]?.headers).toEqual({ Accept: "application/json" });
    expect(calls[0]?.body).toBeUndefined();
  });

  it("a 204 parses as null", async () => {
    const { fetch } = fakeFetch({ "PUT /z": () => ({ status: 204 }) });
    await expect(
      createShellRequest({ baseUrl: "https://api.test", fetch })(z.null(), "/z", { method: "PUT" }),
    ).resolves.toBeNull();
  });

  it("raises the API's error code", async () => {
    const { fetch } = fakeFetch({
      "GET /e": () => ({
        status: 409,
        body: { error: { code: "login_in_use", message: "m", status: 409 } },
      }),
    });
    const err = await createShellRequest({ baseUrl: "https://api.test", fetch })(Thing, "/e").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ShellApiError);
    expect(err).toMatchObject({ code: "login_in_use", status: 409, message: "m" });
  });

  it("raises HTTP_<status> for an error without the API's body", async () => {
    const { fetch } = fakeFetch({ "GET /e": () => ({ status: 502, body: "nope" }) });
    await expect(
      createShellRequest({ baseUrl: "https://api.test", fetch })(Thing, "/e"),
    ).rejects.toMatchObject({ code: "HTTP_502", status: 502 });
  });

  it("raises OFFLINE when fetch throws", async () => {
    const { fetch } = fakeFetch({ "GET /e": () => new TypeError("Network request failed") });
    await expect(
      createShellRequest({ baseUrl: "https://api.test", fetch })(Thing, "/e"),
    ).rejects.toMatchObject({ code: "OFFLINE", status: 0 });
  });

  it("raises BAD_RESPONSE when the answer doesn't parse", async () => {
    const { fetch } = fakeFetch({ "GET /e": () => ({ status: 200, body: { ok: false } }) });
    await expect(
      createShellRequest({ baseUrl: "https://api.test", fetch })(Thing, "/e"),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("trims a trailing slash on the base URL", async () => {
    const { fetch, calls } = fakeFetch({ "GET /y": () => ({ status: 200, body: { ok: true } }) });
    await createShellRequest({ baseUrl: "https://api.test/", fetch })(Thing, "/y");
    expect(calls[0]?.url).toBe("https://api.test/y");
  });
});
