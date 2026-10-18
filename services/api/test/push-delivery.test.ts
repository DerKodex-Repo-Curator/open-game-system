import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  combine,
  deliver,
  type PushMessage,
  type PushSenders,
  type WebSendResult,
} from "../src/lib/push-delivery";
import { grantOgs } from "../src/lib/push-handles";
import type { PushResult } from "../src/providers/push";
import { openTestD1, type TestD1 } from "./support/d1";

/** Routing a handle to its surfaces: last active first, falling through when one can't take it. */
let d1: TestD1;
let sent: string[];
let expoResult: PushResult;
let webResult: WebSendResult;

const senders: PushSenders = {
  expo: async (_platform, token) => {
    sent.push(`expo:${token}`);
    return expoResult;
  },
  web: async (_appId, sub, payload) => {
    sent.push(`web:${sub.endpoint}:${payload.title}:${payload.whenOpen}:${payload.tag ?? ""}`);
    return webResult;
  },
};
const message: PushMessage = {
  appId: "codebreakers",
  title: "Clue: RIVER 2",
  body: "Your guess.",
  url: "https://codebreakers.jonathanrmumm.workers.dev/",
  tag: "cb-KQTP",
  whenOpen: "deliver",
};

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  sent = [];
  expoResult = { success: true, deviceActive: true };
  webResult = "ok";
  await d1.db.batch([
    d1.db.prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('jordan', 'jordan', 'Jordan', 'owl')",
    ),
    d1.db.prepare(
      "INSERT INTO profile_devices (device_id, profile_id, kind, name) VALUES ('j-phone', 'jordan', 'phone', 'Phone')",
    ),
    d1.db.prepare(
      "INSERT INTO devices (ogs_device_id, platform, push_token) VALUES ('j-phone', 'android', 'ExponentPushToken[j]')",
    ),
  ]);
});

/** Jordan's handle with an OGS surface active at `ogsAt` and a web surface active at `webAt`. */
async function bothSurfaces(ogsAt: number, webAt: number) {
  const handle = await grantOgs(d1.db, "jordan", "codebreakers", ogsAt);
  await d1.db
    .prepare(
      `INSERT INTO push_surfaces (id, handle_id, kind, endpoint, p256dh, auth, last_active_at, created_at)
       VALUES ('w1', ?, 'web', 'https://push.example/j', 'p', 'a', ?, 1)`,
    )
    .bind(handle, webAt)
    .run();
  return handle;
}
const surfaces = async () =>
  (await d1.db.prepare("SELECT id FROM push_surfaces ORDER BY id").all()).results.map((r) => r.id);

describe("which surface gets it", () => {
  it("the web surface when it was active last", async () => {
    const h = await bothSurfaces(100, 200);
    expect(await deliver(d1.db, h, message, senders)).toBe("sent");
    expect(sent).toEqual(["web:https://push.example/j:Clue: RIVER 2:deliver:cb-KQTP"]);
  });

  it("the app when it was active last", async () => {
    const h = await bothSurfaces(300, 200);
    expect(await deliver(d1.db, h, message, senders)).toBe("sent");
    expect(sent).toEqual(["expo:ExponentPushToken[j]"]);
  });

  it("falls through to the app when the web subscription is gone, and forgets it", async () => {
    const h = await bothSurfaces(100, 200);
    webResult = "gone";
    expect(await deliver(d1.db, h, message, senders)).toBe("sent");
    expect(sent).toEqual([
      "web:https://push.example/j:Clue: RIVER 2:deliver:cb-KQTP",
      "expo:ExponentPushToken[j]",
    ]);
    expect(await surfaces()).not.toContain("w1");
  });

  it("falls through on a web error but keeps the subscription", async () => {
    const h = await bothSurfaces(100, 200);
    webResult = "error";
    expect(await deliver(d1.db, h, message, senders)).toBe("sent");
    expect(await surfaces()).toContain("w1");
  });

  it("falls through to the web when the app is turned off", async () => {
    const h = await bothSurfaces(300, 200);
    await d1.db.prepare("UPDATE push_grants SET granted = 0").run();
    expect(await deliver(d1.db, h, message, senders)).toBe("sent");
    expect(sent).toEqual(["web:https://push.example/j:Clue: RIVER 2:deliver:cb-KQTP"]);
  });

  it("is gone when the only web subscription is gone", async () => {
    const h = await bothSurfaces(100, 200);
    await d1.db.prepare("DELETE FROM push_surfaces WHERE kind = 'ogs'").run();
    webResult = "gone";
    expect(await deliver(d1.db, h, message, senders)).toBe("gone");
  });

  it("is failed when every surface errors", async () => {
    const h = await bothSurfaces(100, 200);
    webResult = "error";
    expoResult = { success: false, deviceActive: true, error: "rate" };
    expect(await deliver(d1.db, h, message, senders)).toBe("failed");
  });

  it("a web surface missing its keys is gone", async () => {
    const h = await grantOgs(d1.db, "jordan", "codebreakers", 1);
    await d1.db.prepare("DELETE FROM push_surfaces").run();
    await d1.db
      .prepare(
        "INSERT INTO push_surfaces (id, handle_id, kind, endpoint, last_active_at, created_at) VALUES ('w2', ?, 'web', 'https://push.example/x', 1, 1)",
      )
      .bind(h)
      .run();
    expect(await deliver(d1.db, h, message, senders)).toBe("gone");
    expect(sent).toEqual([]);
  });

  it("a web surface missing any one key is gone", async () => {
    const h = await grantOgs(d1.db, "jordan", "codebreakers", 1);
    await d1.db.prepare("DELETE FROM push_surfaces").run();
    for (const [endpoint, p256dh, auth] of [
      [null, "p", "a"],
      ["https://push.example/y", null, "a"],
      ["https://push.example/z", "p", null],
    ]) {
      await d1.db.prepare("DELETE FROM push_surfaces").run();
      await d1.db
        .prepare(
          "INSERT INTO push_surfaces (id, handle_id, kind, endpoint, p256dh, auth, last_active_at, created_at) VALUES ('w3', ?, 'web', ?, ?, ?, 1, 1)",
        )
        .bind(h, endpoint, p256dh, auth)
        .run();
      expect(await deliver(d1.db, h, message, senders)).toBe("gone");
    }
    expect(sent).toEqual([]);
  });

  it("an app surface with no consent record at all is not sent to", async () => {
    const h = await bothSurfaces(300, 200);
    await d1.db.prepare("DELETE FROM push_grants").run();
    await d1.db.prepare("DELETE FROM push_surfaces WHERE kind = 'web'").run();
    expect(await deliver(d1.db, h, message, senders)).toBe("not_permitted");
    expect(sent).toEqual([]);
  });

  it("sends no tag when the message has none", async () => {
    const h = await bothSurfaces(100, 200);
    await deliver(d1.db, h, { ...message, tag: undefined, whenOpen: "banner" }, senders);
    expect(sent).toEqual(["web:https://push.example/j:Clue: RIVER 2:banner:"]);
  });

  it("a handle of another game is not_permitted and nothing is sent", async () => {
    const h = await bothSurfaces(100, 200);
    expect(await deliver(d1.db, h, { ...message, appId: "rocket-crew" }, senders)).toBe(
      "not_permitted",
    );
    expect(sent).toEqual([]);
  });

  it("a handle with no surfaces is not_permitted", async () => {
    const h = await grantOgs(d1.db, "jordan", "codebreakers", 1);
    await d1.db.prepare("DELETE FROM push_surfaces").run();
    expect(await deliver(d1.db, h, message, senders)).toBe("not_permitted");
  });
});

describe("one status from several surfaces", () => {
  it("sent beats failed beats gone beats not_permitted", () => {
    expect(combine(["not_permitted", "gone", "failed", "sent"])).toBe("sent");
    expect(combine(["not_permitted", "gone", "failed"])).toBe("failed");
    expect(combine(["not_permitted", "gone"])).toBe("gone");
    expect(combine(["not_permitted"])).toBe("not_permitted");
    expect(combine([])).toBe("not_permitted");
  });
});
