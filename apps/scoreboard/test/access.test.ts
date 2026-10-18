import { describe, expect, it } from "vitest";
import { access } from "../src/access";

const KEY = "k".repeat(32);

describe("access: the board is behind a key (a link with ?key=, then a cookie)", () => {
  it("no key: not found", () => {
    expect(access(new Request("https://b.dev/"), KEY)).toEqual({ ok: false });
  });
  it("the right ?key= lets in and sets an HttpOnly cookie", () => {
    const a = access(new Request(`https://b.dev/?key=${KEY}`), KEY);
    expect(a.ok).toBe(true);
    expect(a.ok && a.setCookie).toMatch(/^sb=k+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
  });
  it("the cookie lets in on later visits", () => {
    expect(access(new Request("https://b.dev/", { headers: { Cookie: `x=1; sb=${KEY}` } }), KEY)).toEqual({ ok: true, setCookie: null });
  });
  it("a wrong key, or no key configured, never lets in", () => {
    expect(access(new Request("https://b.dev/?key=nope"), KEY).ok).toBe(false);
    expect(access(new Request("https://b.dev/?key="), "").ok).toBe(false);
  });
});
