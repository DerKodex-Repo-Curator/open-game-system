import { GuestJoinedSchema, JoinPreviewSchema } from "@open-game-system/ogs-protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { readClaims } from "../src/lib/identity";
import { SESSION_TTL_MS } from "../src/lib/sessions";
import { openTestD1, type TestD1 } from "./support/d1";

// Acceptance: 2026-10-06-join-and-invite.feature, "An expired or unknown code" and "A guest joins
// from the browser" (the page shows the TV's name and who is already there). The join page
// (opengame.org/join/<code>) asks before anyone has an OGS profile, so it takes no token.
let d1: TestD1;

beforeAll(async () => {
  d1 = await openTestD1();
});
afterAll(() => d1.dispose());
beforeEach(async () => {
  await d1.reset();
  const now = Date.now();
  await d1.db.batch([
    d1.db.prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('mom', 'mom.k', 'Mom', 'sun')",
    ),
    d1.db.prepare(
      "INSERT INTO profiles (id, handle, name, sticker) VALUES ('sam', 'sam.k', 'Sam', 'rocket')",
    ),
    d1.db
      .prepare(
        "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('s1', 'mom', 'NT9WPH', 'Living room TV', ?)",
      )
      .bind(now),
    d1.db
      .prepare(
        "INSERT INTO session_members (session_id, profile_id, joined_at) VALUES ('s1', 'sam', ?)",
      )
      .bind(now),
    d1.db
      .prepare(
        "INSERT INTO couch_sessions (id, host_profile_id, code, tv_name, created_at) VALUES ('old', 'mom', 'ZZZZZZ', 'Den', ?)",
      )
      .bind(now - SESSION_TTL_MS - 1),
  ]);
});

const Body = z.record(z.string(), z.unknown());
async function get(code: string) {
  const res = await app.request(`/api/v1/join/${code}`, {}, { DB: d1.db, OGS_JWT_SECRET: "s" });
  return { status: res.status, body: Body.parse(await res.json()) };
}

describe("GET /api/v1/join/:code", () => {
  it("names the TV, its host and who is on the couch, without a token", async () => {
    const r = await get("NT9WPH");
    expect(r.status).toBe(200);
    expect(JoinPreviewSchema.parse(r.body)).toEqual({
      code: "NT9WPH",
      tvName: "Living room TV",
      host: { name: "Mom", sticker: "sun" },
      couch: [
        { name: "Mom", sticker: "sun" },
        { name: "Sam", sticker: "rocket" },
      ],
    });
  });

  it("gives away no profile ids or @ids", async () => {
    const text = JSON.stringify((await get("NT9WPH")).body);
    for (const secret of ["mom.k", "sam.k", '"s1"', '"mom"', '"sam"'])
      expect(text).not.toContain(secret);
  });

  it("reads a typed code: lower case, spaces and dashes", async () => {
    expect((await get("nt9-wph")).status).toBe(200);
  });

  it("says the couch isn't on any more for an expired or unknown code", async () => {
    for (const code of ["ZZZZZZ", "QQQQQQ"]) {
      const r = await get(code);
      expect(r.status).toBe(404);
      expect(r.body).toEqual({
        error: { code: "session_not_found", message: "That couch isn't on any more", status: 404 },
      });
    }
  });

  it("refuses something that can't be a TV code", async () => {
    const r = await get("NT9");
    expect(r.status).toBe(400);
  });
});

// "A guest joins from the browser without the app": a name and a sticker, no install, no account.
describe("POST /api/v1/join/:code/guest", () => {
  async function guest(code: string, body: unknown) {
    const res = await app.request(
      `/api/v1/join/${code}/guest`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { DB: d1.db, OGS_JWT_SECRET: "s" },
    );
    return { status: res.status, body: Body.parse(await res.json()) };
  }

  it("puts a guest on the couch with a name and a sticker, and gives the browser a phone token", async () => {
    const r = await guest("nt9wph", { name: "Grandma", sticker: "owl" });
    expect(r.status).toBe(201);
    const joined = GuestJoinedSchema.parse(r.body);
    expect(joined).toMatchObject({ sessionId: "s1", code: "NT9WPH", tvName: "Living room TV" });
    const claims = await readClaims(joined.token, "s", Date.now());
    expect(claims).toMatchObject({ kind: "phone" });
    expect(claims?.did).toMatch(/^guest-/);
    expect((await get("NT9WPH")).body.couch).toEqual([
      { name: "Mom", sticker: "sun" },
      { name: "Sam", sticker: "rocket" },
      { name: "Grandma", sticker: "owl" },
    ]);
    const marked = await d1.db
      .prepare("SELECT session_id FROM guest_profiles WHERE profile_id = ?")
      .bind(claims?.sub ?? "")
      .first();
    expect(marked).toEqual({ session_id: "s1" });
  });

  it("asks for a name (1-30 characters) and a sticker", async () => {
    for (const body of [
      { sticker: "owl" },
      { name: " ", sticker: "owl" },
      { name: "x".repeat(31), sticker: "owl" },
      { name: "Gran" },
      { name: "Gran", sticker: "../x" },
    ])
      expect((await guest("NT9WPH", body)).status).toBe(400);
  });

  it("can't join a couch that isn't on any more", async () => {
    expect((await guest("ZZZZZZ", { name: "Gran", sticker: "owl" })).status).toBe(404);
  });
});
