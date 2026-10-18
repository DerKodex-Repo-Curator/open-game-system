import { describe, expect, it } from "vitest";
import { claimRoomCode, deadEndPage, goPath, tvStartPath, wsProbe } from "../src/worker";

describe("claimRoomCode: a code nobody is using, for a new TV", () => {
  it("takes the first code the room accepts", async () => {
    const asked: string[] = [];
    const code = await claimRoomCode(async (c) => {
      asked.push(c);
      return asked.length === 3;
    });
    expect(asked).toHaveLength(3);
    expect(code).toBe(asked[2]);
  });

  it("asks the same code again when claiming it threw (the room reset itself to recycle the code)", async () => {
    const asked: string[] = [];
    const code = await claimRoomCode(async (c) => {
      asked.push(c);
      if (asked.length === 1) throw new Error("aborted: room code recycled");
      return true;
    });
    expect(asked).toEqual([code, code]);
  });

  it("gives up after 8 codes", async () => {
    await expect(claimRoomCode(async () => false)).rejects.toThrow("no free room code");
  });
});

describe("deadEndPage: a phone that can't join gets a page that says why and offers a way on", () => {
  const base = { game: "Rocket Crew", code: "ABCD" };

  it.each([
    ["missing", "No game with that code"],
    ["ended", "That game is over"],
    ["full", "Every seat is taken"],
  ] as const)("%s says %s, shows the code, and offers to retype it and to start a game", (gate, title) => {
    const html = deadEndPage({ ...base, gate });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(title);
    expect(html).toContain("(ABCD)");
    expect(html).toContain('action="/go"');
    expect(html).toContain('href="/"');
    expect(html).toContain("<title>Rocket Crew</title>");
  });

  it("one primary action: Join for a wrong code, Start a game when the room ended or is full", () => {
    expect(deadEndPage({ ...base, gate: "missing" })).toMatch(/class="primary"[^>]*>Join/);
    expect(deadEndPage({ ...base, gate: "ended" })).toMatch(/class="primary"[^>]*href="\/"/);
  });

  it("takes the game's own words and stylesheet", () => {
    const html = deadEndPage({ ...base, gate: "full", copy: { full: { title: "This rocket is full", line: "Start your own." } }, stylesheets: ["/styles.css"] });
    expect(html).toContain("This rocket is full");
    expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
  });

  it("never prints anything but a room code, or the game name escaped", () => {
    const html = deadEndPage({ game: "<b>G</b>", code: "<script>", gate: "missing" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>G</b>");
  });
});

describe("tvStartPath: the front page makes a room and opens its TV, keeping ?ref=", () => {
  it.each([
    ["https://x.dev/", "/tv/ABCD"],
    ["https://x.dev/?ref=HN", "/tv/ABCD?ref=hn"],
    ["https://x.dev/?ref=%3Cb%3E&utm=1", "/tv/ABCD"],
  ])("%s → %s", (url, path) => {
    expect(tvStartPath(new URL(url), "ABCD")).toBe(path);
  });

  it("the TV route's prefix is the game's", () => {
    expect(tvStartPath(new URL("https://x.dev/?ref=hn"), "ABCD", "/screen/")).toBe("/screen/ABCD?ref=hn");
  });
});

describe("wsProbe", () => {
  it("refuses a plain request (426): only WebSocket upgrades are echoed", () => {
    expect(wsProbe(new Request("https://x.dev/ws-probe")).status).toBe(426);
  });
});

describe("goPath: the dead-end page's code box", () => {
  it.each([
    ["https://x.dev/go?code=ab-cd", "/join/ABCD"],
    ["https://x.dev/go?code=zz", "/"],
    ["https://x.dev/go", "/"],
  ])("%s → %s", (url, path) => {
    expect(goPath(new URL(url))).toBe(path);
  });
  it("the join route's prefix is the game's", () => {
    expect(goPath(new URL("https://x.dev/go?code=abcd"), "/j/")).toBe("/j/ABCD");
  });
});
