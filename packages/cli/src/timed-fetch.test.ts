import { describe, expect, it } from "vitest";
import { CliError } from "./io";
import { timedFetch } from "./timed-fetch";

/** A fetch that answers after `ms`, or rejects when its signal aborts first (as fetch does). */
const slowFetch =
  (ms: number): typeof fetch =>
  (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response("ok")), ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(init.signal?.reason);
      });
    });

describe("timedFetch: no ogs command waits on a URL forever", () => {
  it("answers a fetch that is quicker than the limit", async () => {
    const res = await timedFetch(slowFetch(5), 1000)("https://game.example/");
    expect(await res.text()).toBe("ok");
  });

  it("gives up after the limit with a CliError naming the URL and the wait", async () => {
    const pending = timedFetch(slowFetch(5000), 50)("https://game.example/tv");
    await expect(pending).rejects.toBeInstanceOf(CliError);
    await expect(timedFetch(slowFetch(5000), 50)("https://game.example/tv")).rejects.toThrow(
      "https://game.example/tv didn't answer within 0.05 s",
    );
  });

  it("still lets the caller abort for its own reasons", async () => {
    const own = new AbortController();
    const pending = timedFetch(slowFetch(5000), 10_000)("https://game.example/", {
      signal: own.signal,
    });
    own.abort(new Error("stopped"));
    await expect(pending).rejects.toThrow("stopped");
  });
});
