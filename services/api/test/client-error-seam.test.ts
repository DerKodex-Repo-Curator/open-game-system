// The app's own client log and JS-error capture (the shell, which apps/mobile re-exports), end to
// end against the Worker.
import { clientEventsSender, createClientLog } from "@open-game-system/shell/modules/client-log";
import { captureJsErrors, type GlobalHandler } from "@open-game-system/shell/modules/js-errors";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { issueToken } from "../src/lib/identity";
import { openTestD1, type TestD1 } from "./support/d1";

/**
 * The client-error seam (docs/agents/observability.md): an error the app didn't catch reaches RN's
 * global handler, goes through the app's client log to POST /api/v1/client-events, and comes out
 * of the Worker exactly once as console.error, with the type and message sre-agent groups by
 * (`errorType`, `error`), and without the player's name or token.
 */
const SECRET = "client-seam-secret";
let d1: TestD1;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  await d1.db
    .prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('kid', 'rocketkid', 'Juneau Testname', 'rocket')",
    )
    .run();
});
afterEach(() => vi.restoreAllMocks());

const Line = z.object({
  kind: z.literal("client_event"),
  source: z.literal("mobile"),
  name: z.string(),
  level: z.literal("error"),
  error: z.string(),
  errorType: z.string(),
  profileId: z.string(),
});

describe("client error seam: app → POST /api/v1/client-events → Workers Logs", () => {
  it("a thrown error is logged by the Worker exactly once as console.error with its type and message, and no names", async () => {
    const token = await issueToken({ sub: "kid", did: "kid-ipad", kind: "tablet" }, SECRET, {
      now: Date.now(),
      ttlSeconds: 60,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const log = createClientLog({
      send: clientEventsSender({
        baseUrl: "https://api.test",
        fetch: async (url, init) =>
          app.request(new URL(url).pathname, init, {
            DB: d1.db,
            OGS_JWT_SECRET: SECRET,
          }),
        auth: () => ({ token }),
      }),
      context: () => ({ app: "mobile", version: "1.0.0", build: "7", profileId: "kid" }),
      now: Date.now,
      schedule: () => () => {},
    });
    let handler: GlobalHandler = () => {};
    captureJsErrors(log, {
      errorUtils: {
        getGlobalHandler: () => handler,
        setGlobalHandler: (h) => {
          handler = h;
        },
      },
    });

    handler(new TypeError("Cannot read property 'sticker' of undefined"), false);
    await log.flush();

    expect(error).toHaveBeenCalledTimes(1);
    const raw = String(error.mock.calls[0][0]);
    const line = Line.parse(JSON.parse(raw));
    expect(line).toMatchObject({
      name: "app.js_error",
      errorType: "TypeError",
      error: "Cannot read property 'sticker' of undefined",
      profileId: "kid",
    });
    expect(raw).not.toContain("Juneau");
    expect(raw).not.toContain(token);
  });
});
