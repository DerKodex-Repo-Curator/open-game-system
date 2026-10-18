import { describe, expect, it } from "vitest";
import { GUEST_STICKERS, guestScreen, joinAsGuest, readGuestFrame } from "./guest";

// Acceptance: 2026-10-06-join-and-invite.feature, "A guest joins from the browser without the app",
// "A game starts and every phone opens it", "Home brings every phone back".

type Reply = { status: number; ok: boolean; json(): Promise<unknown> };
const reply = (status: number, body: unknown) => async (): Promise<Reply> => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const joined = { token: "t", sessionId: "s1", code: "NT9WPH", tvName: "Living room TV" };

describe("joinAsGuest", () => {
  it("posts the name and sticker to the couch's code", async () => {
    const sent: { url: string; body: string }[] = [];
    const r = await joinAsGuest(
      "https://api.test/",
      "nt9-wph",
      { name: " Grandma ", sticker: "owl" },
      async (url, init) => {
        sent.push({ url, body: String(init?.body) });
        return reply(201, joined)();
      },
    );
    expect(r).toEqual({ kind: "joined", joined });
    expect(sent).toEqual([
      {
        url: "https://api.test/api/v1/join/NT9WPH/guest",
        body: JSON.stringify({ name: "Grandma", sticker: "owl" }),
      },
    ]);
  });

  it("is gone for a couch that isn't on, bad for a missing name, offline otherwise", async () => {
    expect(
      await joinAsGuest("https://a", "NT9WPH", { name: "G", sticker: "owl" }, reply(404, {})),
    ).toEqual({ kind: "gone" });
    expect(
      await joinAsGuest("https://a", "NT9WPH", { name: "  ", sticker: "owl" }, reply(201, joined)),
    ).toEqual({ kind: "bad" });
    expect(
      await joinAsGuest("https://a", "NT9WPH", { name: "G", sticker: "owl" }, reply(500, {})),
    ).toEqual({ kind: "offline" });
    expect(
      await joinAsGuest("https://a", "NT9WPH", { name: "G", sticker: "owl" }, async () => {
        throw new TypeError("x");
      }),
    ).toEqual({ kind: "offline" });
  });

  it("offers the stickers the app does", () => {
    expect(GUEST_STICKERS).toEqual([
      "bear",
      "owl",
      "dragon",
      "dinosaur",
      "turtle",
      "whale",
      "firefly",
      "mouse",
      "cloud",
    ]);
  });
});

describe("guestScreen: where a guest's browser is, as the TV moves", () => {
  const games = [
    { appId: "rocket-crew", startUrl: "https://rc.example/" },
    {
      appId: "bake-shop",
      startUrl: "https://bake.example/play?x=1",
      tvUrl: "https://bake.example/tv",
    },
  ];
  const game = (appId: string, room?: string) => ({
    kind: "game" as const,
    appId,
    instanceId: "i1",
    roleId: "player",
    ...(room ? { room } : {}),
  });

  it("on Home, the remote", () => {
    expect(guestScreen({ kind: "launcher" }, games)).toEqual({ kind: "remote" });
  });

  it("a game in a room opens its start page in that room", () => {
    expect(guestScreen(game("rocket-crew", "KQTP"), games)).toEqual({
      kind: "game",
      appId: "rocket-crew",
      url: "https://rc.example/?ogsRoom=KQTP",
    });
  });

  it("a game with a fixed TV page opens its start page at once", () => {
    expect(guestScreen(game("bake-shop"), games)).toEqual({
      kind: "game",
      appId: "bake-shop",
      url: "https://bake.example/play?x=1",
    });
  });

  it("a game that makes rooms waits for the TV to name one; an unknown game stays on the remote", () => {
    expect(guestScreen(game("rocket-crew"), games)).toEqual({ kind: "wait" });
    expect(guestScreen(game("mystery", "KQTP"), games)).toEqual({ kind: "remote" });
  });
});

describe("readGuestFrame: what the couch session tells a guest's browser", () => {
  it("reads a follow", () => {
    const target = {
      kind: "game",
      appId: "bake-shop",
      instanceId: "i1",
      roleId: "player",
      room: "KQTP",
    };
    expect(readGuestFrame(JSON.stringify({ type: "follow", target }))).toEqual({
      type: "follow",
      target,
    });
    expect(
      readGuestFrame(JSON.stringify({ type: "follow", target: { kind: "launcher" } })),
    ).toEqual({
      type: "follow",
      target: { kind: "launcher" },
    });
  });

  it("reads who is on the couch and the game on the TV from a state", () => {
    const frame = readGuestFrame(
      JSON.stringify({
        type: "state",
        state: {
          members: [{ profileId: "p1", name: "Dana", sticker: "bear" }],
          current: { appId: "bake-shop" },
          extra: true,
        },
      }),
    );
    expect(frame).toEqual({
      type: "state",
      members: [{ name: "Dana", sticker: "bear" }],
      currentAppId: "bake-shop",
    });
  });

  it("ignores anything else", () => {
    expect(readGuestFrame("not json")).toBeNull();
    expect(readGuestFrame(JSON.stringify({ type: "remote.offer", from: "x" }))).toBeNull();
    expect(readGuestFrame(JSON.stringify({ type: "follow", target: { kind: "nope" } }))).toBeNull();
  });
});
