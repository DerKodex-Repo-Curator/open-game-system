import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, handleSignup, handleVisit } from "../src/waitlist";

/** The real schema in an in-memory SQLite, behind the slice of D1's API the handlers use. */
function sqliteDb(): { db: Db; all: (sql: string) => unknown[] } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(__dirname, "../migrations/0001_waitlist.sql"), "utf8"));
  const db: Db = {
    prepare: (sql) => ({
      bind: (...values) => ({
        run: async () => {
          const r = sqlite.prepare(sql).run(...values.map((v) => v ?? null));
          return { meta: { changes: Number(r.changes) } };
        },
      }),
    }),
  };
  return { db, all: (sql) => sqlite.prepare(sql).all() };
}

const NOW = () => new Date("2026-10-19T15:00:00Z");
const post = (body: string, type: string, accept = "application/json") =>
  new Request("https://ogs-docs.pages.dev/api/waitlist", {
    method: "POST",
    body,
    headers: { "content-type": type, accept },
  });
const json = (v: unknown) => post(JSON.stringify(v), "application/json");

let t: ReturnType<typeof sqliteDb>;
beforeEach(() => {
  t = sqliteDb();
});

describe("joining the waitlist", () => {
  it("stores the email once, with what they build and where they came from", async () => {
    const res = await handleSignup(
      json({
        email: " Dev@Example.com ",
        building: "a Phaser party game",
        engine: "phaser",
        utm_source: "hn",
        utm_medium: "post",
        utm_campaign: "bet4",
        ref: "https://news.ycombinator.com/",
      }),
      t.db,
      NOW,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(t.all("SELECT * FROM waitlist")).toEqual([
      {
        email: "dev@example.com",
        building: "a Phaser party game",
        engine: "phaser",
        utm_source: "hn",
        utm_medium: "post",
        utm_campaign: "bet4",
        referrer: "https://news.ycombinator.com/",
        created_at: "2026-10-19T15:00:00.000Z",
      },
    ]);
  });

  it("answers ok to the same email twice and keeps the first signup's source", async () => {
    await handleSignup(json({ email: "a@b.co", utm_source: "x" }), t.db, NOW);
    const again = await handleSignup(json({ email: "a@b.co", utm_source: "hn" }), t.db, NOW);
    expect(again.status).toBe(200);
    expect(t.all("SELECT email, utm_source FROM waitlist")).toEqual([{ email: "a@b.co", utm_source: "x" }]);
  });

  it("rejects a malformed email with the API error shape", async () => {
    const res = await handleSignup(json({ email: "nope" }), t.db, NOW);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "invalid_email", message: expect.any(String), status: 400 },
    });
    expect(t.all("SELECT * FROM waitlist")).toEqual([]);
  });

  it("works as a plain HTML form post: redirects back to the page", async () => {
    const res = await handleSignup(
      post("email=c%40d.co&building=&utm_source=x", "application/x-www-form-urlencoded", "text/html"),
      t.db,
      NOW,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/on-tv?joined=1#join");
    expect(t.all("SELECT email FROM waitlist")).toEqual([{ email: "c@d.co" }]);
  });

  it("sends a bad form post back to the form with an error", async () => {
    const res = await handleSignup(post("email=bad", "application/x-www-form-urlencoded", "text/html"), t.db, NOW);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/on-tv?error=email#join");
  });

  it("drops bots that fill the hidden field, without telling them", async () => {
    const res = await handleSignup(json({ email: "bot@spam.co", website: "http://spam" }), t.db, NOW);
    expect(res.status).toBe(200);
    expect(t.all("SELECT * FROM waitlist")).toEqual([]);
  });

  it("ignores an engine it doesn't know rather than storing free text there", async () => {
    await handleSignup(json({ email: "e@f.co", engine: "<script>" }), t.db, NOW);
    expect(t.all("SELECT engine FROM waitlist")).toEqual([{ engine: null }]);
  });
});

describe("counting visits per source", () => {
  it("stores one row per view with its UTM tags and no personal data", async () => {
    const req = new Request("https://ogs-docs.pages.dev/api/visit", {
      method: "POST",
      body: JSON.stringify({ path: "/on-tv", utm_source: "x", utm_medium: "post", utm_campaign: "bet4", ref: "" }),
    });
    const res = await handleVisit(req, t.db, NOW);
    expect(res.status).toBe(204);
    expect(t.all("SELECT path, utm_source, utm_medium, utm_campaign, referrer, created_at FROM visits")).toEqual([
      { path: "/on-tv", utm_source: "x", utm_medium: "post", utm_campaign: "bet4", referrer: null, created_at: "2026-10-19T15:00:00.000Z" },
    ]);
  });

  it("ignores a malformed beacon", async () => {
    const req = new Request("https://ogs-docs.pages.dev/api/visit", { method: "POST", body: "{not json" });
    expect((await handleVisit(req, t.db, NOW)).status).toBe(400);
    expect(t.all("SELECT * FROM visits")).toEqual([]);
  });
});
