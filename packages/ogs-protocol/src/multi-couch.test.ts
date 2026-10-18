// Several couches, one room (docs/specification.md §7, acceptance 2026-10-05-multi-couch.feature).
import { describe, expect, it } from "vitest";
import { GameToLauncherSchema, LauncherToGameSchema } from "./frame";
import { PresenceSchema } from "./friends";
import { CouchClaimSchema, GameTokenSchema } from "./game-token";
import { ManifestSchema } from "./manifest";
import {
  FriendRoomSchema,
  GameInviteRequestSchema,
  GameInviteResultSchema,
  playLink,
  readGameLink,
  readOpenLink,
  readPlayLink,
  roomStartUrl,
  whoIsPlaying,
} from "./rooms";
import {
  type ClientMessage,
  ClientMessageSchema,
  initialSession,
  RoomIdSchema,
  reduceSession,
  type SessionState,
  SessionStateSchema,
} from "./session";

const member = (profileId: string) => ({ profileId, name: profileId, sticker: "bear" });
function run(msgs: ClientMessage[], from: SessionState = initialSession("s-1", "dad")) {
  let s = from;
  const outs = [];
  for (const [i, m] of msgs.entries()) {
    const r = reduceSession(s, m, 1_000 + i);
    s = r.state;
    outs.push(...r.out);
  }
  return { s, outs };
}
const couch = (): ClientMessage[] => [
  { type: "hello", deviceId: "phone-sam", kind: "phone", profile: member("sam") },
  { type: "hello", deviceId: "tv", kind: "launcher" },
];
const start = (room?: string): ClientMessage => ({
  type: "game.start",
  appId: "night-flight",
  mode: "new",
  hostDeviceId: "phone-sam",
  ...(room ? { room } : {}),
});

describe("manifest: multiCouch", () => {
  const valid = {
    appId: "night-flight",
    name: "Night Flight",
    shape: "couch",
    tv: "required",
    startUrl: "https://night-flight.example/host",
    art: { tile: "https://night-flight.example/tile.png" },
  };
  it("a game that accepts several couches says multiCouch: true", () => {
    expect(ManifestSchema.parse({ ...valid, multiCouch: true }).multiCouch).toBe(true);
  });
  it("a game that says nothing is single-couch", () => {
    expect(ManifestSchema.parse(valid).multiCouch ?? false).toBe(false);
  });
  it("multiCouch must be a boolean", () => {
    expect(ManifestSchema.safeParse({ ...valid, multiCouch: "yes" }).success).toBe(false);
  });
});

describe("room ids", () => {
  it.each(["KQTP", "room_1", "a-b", "x".repeat(64)])("%s is a room id", (room) => {
    expect(RoomIdSchema.parse(room)).toBe(room);
  });
  it.each(["", "x".repeat(65), "KQ TP", "a/b", "a?b"])("%j is not", (room) => {
    expect(RoomIdSchema.safeParse(room).success).toBe(false);
  });
});

describe("game tokens: couch claim", () => {
  const claims = {
    iss: "https://api.opengame.org",
    aud: "night-flight",
    sub: "p_sam",
    handle: "sam",
    name: "Sam",
    avatar: "https://tv.opengame.org/art/story-nook/char-bear.webp",
    iat: 1_900_000_000,
    exp: 1_900_003_600,
  };
  it("a token for a couch names its session and label", () => {
    const withCouch = { ...claims, couch: { sid: "s-smith", label: "Sam" } };
    expect(GameTokenSchema.parse(withCouch)).toEqual(withCouch);
  });
  it("a token with no couch is still valid", () => {
    expect(GameTokenSchema.parse(claims)).toEqual(claims);
  });
  it.each([
    { sid: "", label: "Sam" },
    { sid: "s", label: "" },
    { sid: "s" },
  ])("a couch claim needs a sid and a label (%j)", (bad) => {
    expect(CouchClaimSchema.safeParse(bad).success).toBe(false);
    expect(GameTokenSchema.safeParse({ ...claims, couch: bad }).success).toBe(false);
  });
});

describe("frame messages: room", () => {
  const ogsStart = {
    type: "ogs:start",
    instanceId: "nf-1",
    mode: "new",
    roster: [],
    token: "signed.jwt",
  };
  it("ogs:start may name the room to join", () => {
    expect(LauncherToGameSchema.parse({ ...ogsStart, room: "KQTP" })).toEqual({
      ...ogsStart,
      room: "KQTP",
    });
  });
  it("ogs:start with a bad room is rejected", () => {
    expect(LauncherToGameSchema.safeParse({ ...ogsStart, room: "a b" }).success).toBe(false);
  });
  it("the game reports its room with ogs:room", () => {
    expect(GameToLauncherSchema.parse({ type: "ogs:room", room: "KQTP" })).toEqual({
      type: "ogs:room",
      room: "KQTP",
    });
  });
  it("ogs:room without a room id is rejected", () => {
    expect(GameToLauncherSchema.safeParse({ type: "ogs:room" }).success).toBe(false);
    expect(GameToLauncherSchema.safeParse({ type: "ogs:room", room: "" }).success).toBe(false);
  });
});

describe("couch session: rooms", () => {
  it("game.start and game.room parse with a room", () => {
    expect(ClientMessageSchema.parse(start("KQTP"))).toEqual(start("KQTP"));
    const report = { type: "game.room", appId: "night-flight", room: "KQTP" };
    expect(ClientMessageSchema.parse(report)).toEqual(report);
    expect(ClientMessageSchema.safeParse({ ...start(), room: "a b" }).success).toBe(false);
  });

  it("starting into a room opens a new sitting in that room", () => {
    const { s } = run([...couch(), start("KQTP")]);
    expect(s.current?.room).toBe("KQTP");
    expect(s.current?.appId).toBe("night-flight");
    expect(s.screen).toBe("game");
  });

  it("a start with no room has no room until the game reports one", () => {
    const { s } = run([...couch(), start()]);
    expect(s.current?.room).toBeUndefined();
    const reported = run([{ type: "game.room", appId: "night-flight", room: "KQTP" }], s).s;
    expect(reported.current?.room).toBe("KQTP");
    expect(reported.current?.instanceId).toBe(s.current?.instanceId);
  });

  it("a room report for another game changes nothing", () => {
    const { s } = run([...couch(), start()]);
    const after = run([{ type: "game.room", appId: "rocket-crew", room: "PQWS" }], s).s;
    expect(after).toBe(s);
  });

  it("a room report with no game on changes nothing", () => {
    const s = run(couch()).s;
    expect(run([{ type: "game.room", appId: "night-flight", room: "KQTP" }], s).s).toBe(s);
  });

  it("the same room reported again keeps the same state object", () => {
    const s = run([...couch(), start("KQTP")]).s;
    expect(run([{ type: "game.room", appId: "night-flight", room: "KQTP" }], s).s).toBe(s);
  });

  it("Home keeps the room on the paused sitting; Continue goes back into it", () => {
    const on = run([...couch(), start("KQTP")]).s;
    const id = on.current?.instanceId;
    const home = run([{ type: "home" }], on).s;
    expect(home.suspended[0]).toMatchObject({
      appId: "night-flight",
      instanceId: id,
      room: "KQTP",
    });
    const back = run(
      [{ type: "game.start", appId: "night-flight", mode: "continue", hostDeviceId: "phone-sam" }],
      home,
    ).s;
    expect(back.current?.instanceId).toBe(id);
    expect(back.current?.room).toBe("KQTP");
  });

  it("starting into the room of a paused sitting resumes that sitting", () => {
    const home = run([...couch(), start("KQTP"), { type: "home" }]).s;
    const id = home.suspended[0]?.instanceId;
    const back = run([start("KQTP")], home).s;
    expect(back.current?.instanceId).toBe(id);
    expect(back.current?.room).toBe("KQTP");
    expect(back.suspended).toEqual([]);
  });

  it("starting into another room of the game on the TV opens a new sitting", () => {
    const on = run([...couch(), start("KQTP")]).s;
    const other = run([start("ZZZZ")], on).s;
    expect(other.current?.room).toBe("ZZZZ");
    expect(other.current?.instanceId).not.toBe(on.current?.instanceId);
    expect(other.suspended[0]).toMatchObject({ room: "KQTP" });
  });

  it("starting into the room already on changes nothing", () => {
    const on = run([...couch(), start("KQTP")]).s;
    expect(run([start("KQTP")], on).s).toBe(on);
  });

  it("starting into a room while the game runs its own room opens a new sitting there", () => {
    const on = run([...couch(), start()]).s;
    const joined = run([start("KQTP")], on).s;
    expect(joined.current?.room).toBe("KQTP");
    expect(joined.current?.instanceId).not.toBe(on.current?.instanceId);
  });

  it("the host phone follows into the room", () => {
    const { s, outs } = run([...couch(), start("KQTP")]);
    expect(outs).toContainEqual({
      to: { deviceId: "phone-sam" },
      msg: {
        type: "follow",
        target: {
          kind: "game",
          appId: "night-flight",
          instanceId: s.current?.instanceId,
          roleId: "host",
          room: "KQTP",
        },
      },
    });
  });

  it("a session with rooms round-trips through its schema", () => {
    const s = run([...couch(), start("KQTP"), { type: "home" }, start("ZZZZ")]).s;
    expect(SessionStateSchema.parse(s)).toEqual(s);
  });
});

describe("play links", () => {
  it("builds the invite link for a game's room", () => {
    expect(playLink("https://opengame.org", "night-flight", "KQTP")).toBe(
      "https://opengame.org/play/night-flight?room=KQTP",
    );
    expect(playLink("http://localhost:5173/", "night-flight", "KQTP")).toBe(
      "http://localhost:5173/play/night-flight?room=KQTP",
    );
  });

  it.each([
    ["https://opengame.org/play/night-flight?room=KQTP", { appId: "night-flight", room: "KQTP" }],
    [
      "https://opengame.org/play/night-flight/?room=KQTP&x=1",
      { appId: "night-flight", room: "KQTP" },
    ],
    ["opengame://play/night-flight?room=KQTP", { appId: "night-flight", room: "KQTP" }],
    ["opengameapp://play/night-flight?room=KQTP", { appId: "night-flight", room: "KQTP" }],
    ["http://localhost:5173/play/trivia-jam?room=ab_9", { appId: "trivia-jam", room: "ab_9" }],
  ])("reads %s", (url, want) => {
    expect(readPlayLink(url)).toEqual(want);
  });

  it.each([
    "https://opengame.org/play/night-flight",
    "https://opengame.org/play/night-flight?room=",
    "https://opengame.org/play/Night_Flight?room=KQTP",
    "https://opengame.org/play/night-flight?room=a%20b",
    "https://opengame.org/add/abcdefghijklmnopqrst",
    "not a url",
  ])("ignores %s", (url) => {
    expect(readPlayLink(url)).toBeNull();
  });
});

describe("invites and rooms over the API", () => {
  it("an invite names the room and one to twenty friends", () => {
    expect(GameInviteRequestSchema.parse({ room: "KQTP", to: ["p1"] })).toEqual({
      room: "KQTP",
      to: ["p1"],
    });
    expect(GameInviteRequestSchema.safeParse({ room: "KQTP", to: [] }).success).toBe(false);
    expect(
      GameInviteRequestSchema.safeParse({ room: "KQTP", to: Array(21).fill("p") }).success,
    ).toBe(false);
    expect(GameInviteRequestSchema.safeParse({ room: "a b", to: ["p1"] }).success).toBe(false);
  });

  it("a friends' room lists its couches", () => {
    const room = {
      appId: "night-flight",
      game: { appId: "night-flight", name: "Night Flight" },
      room: "KQTP",
      couches: [
        {
          sessionId: "s-mumm",
          label: "Jonathan",
          host: { id: "jon", handle: "jonathan.m", name: "Jonathan", sticker: "bear" },
        },
      ],
      joined: false,
    };
    expect(FriendRoomSchema.parse(room)).toEqual(room);
  });

  it.each([
    [[], ""],
    [["Jonathan"], "Jonathan is playing"],
    [["Jonathan", "Sam"], "Jonathan and Sam are playing"],
    [["Jonathan", "Sam", "Kim"], "Jonathan, Sam and Kim are playing"],
  ])("%j: %s", (labels, line) => {
    expect(whoIsPlaying(labels)).toBe(line);
  });

  it("presence may carry the room", () => {
    const casting = {
      kind: "casting",
      sessionId: "s",
      tvName: "TV",
      game: { appId: "night-flight", name: "Night Flight" },
      room: "KQTP",
    };
    expect(PresenceSchema.parse(casting)).toEqual(casting);
  });
});

// 2026-10-07-game-links.feature, "An outside developer's domain goes through the play link": a play
// link without a room opens the OGS app on that game (its page, where Play is the one button).
describe("a game link (a play link without a room)", () => {
  it.each([
    ["https://opengame.org/play/night-flight", "night-flight"],
    ["https://opengame.org/play/night-flight/", "night-flight"],
    ["https://opengame.org/play/night-flight?utm_source=frontdoor", "night-flight"],
    ["https://opengame.org/play/night-flight?room=", "night-flight"],
    ["opengame://play/trivia-jam", "trivia-jam"],
    ["http://localhost:5173/play/rocket-crew#x", "rocket-crew"],
    ["http://localhost:5173/play/rocket-crew#xy", "rocket-crew"],
  ])("reads %s", (url, appId) => {
    expect(readGameLink(url)).toEqual({ appId });
  });

  it.each([
    "https://opengame.org/play/night-flight?room=KQTP",
    "https://opengame.org/play/Night_Flight",
    "https://opengame.org/play/",
    "https://opengame.org/play/night-flight/more",
    "https://opengame.org/join/NT9WPH",
    "see https://opengame.org/play/night-flight",
    "not a url",
  ])("ignores %s", (url) => {
    expect(readGameLink(url)).toBeNull();
  });
});

// The older game link (opengame.org/open?url=<game page>) opened without the app: the site offers
// the app (opengame://open?url=…) and the game's own page in the browser. https pages only, so the
// site never sends anyone to another scheme or a plain-http page.
describe("an open link (opengame.org/open?url=<game page>)", () => {
  it("reads the game's page and the app link for it", () => {
    const page = "https://bake-shop.jonathanrmumm.workers.dev/";
    expect(readOpenLink(`https://opengame.org/open?url=${encodeURIComponent(page)}`)).toEqual({
      page,
      host: "bake-shop.jonathanrmumm.workers.dev",
      app: `opengame://open?url=${encodeURIComponent(page)}`,
    });
  });

  it.each([
    "https://opengame.org/open",
    "https://opengame.org/open?url=",
    `https://opengame.org/open?url=${encodeURIComponent("http://bake.example/")}`,
    `https://opengame.org/open?url=${encodeURIComponent("javascript:alert(1)")}`,
    `https://opengame.org/open?url=${encodeURIComponent("https://bake.example/a b")}`,
    `https://opengame.org/open?url=${encodeURIComponent("xhttps://bake.example/")}`,
    `see https://opengame.org/open?url=${encodeURIComponent("https://bake.example/")}`,
    "https://opengame.org/open?url=%E0%A4%A",
    "https://opengame.org/play/bake-shop",
  ])("ignores %s", (url) => {
    expect(readOpenLink(url)).toBeNull();
  });
});

describe("an open link's page, any https shape", () => {
  it.each([
    "https://bake.example",
    "https://bake.example/x",
    "https://bake.example/x?y=1#z",
  ])("reads %s", (page) => {
    expect(readOpenLink(`https://opengame.org/open?url=${encodeURIComponent(page)}`)?.page).toBe(
      page,
    );
  });
});

// roomStartUrl moved here from the app (2026-10-18); the app's rooms tests cover it too.
describe("a joining couch's start page", () => {
  it("adds ogsRoom to the start URL, after a query, before a hash", () => {
    expect(roomStartUrl("https://g.example/", "KQTP")).toBe("https://g.example/?ogsRoom=KQTP");
    expect(roomStartUrl("https://g.example/?a=1", "KQ TP")).toBe(
      "https://g.example/?a=1&ogsRoom=KQ%20TP",
    );
    expect(roomStartUrl("https://g.example/#lobby", "KQTP")).toBe(
      "https://g.example/?ogsRoom=KQTP#lobby",
    );
  });
});

describe("an invite's result", () => {
  it("names the link and, per friend, whether a push went", () => {
    const ok = {
      link: "https://opengame.org/play/x?room=R",
      invited: [{ profileId: "p1", pushed: true }],
    };
    expect(GameInviteResultSchema.parse(ok)).toEqual(ok);
    expect(GameInviteResultSchema.safeParse({ ...ok, invited: [{}] }).success).toBe(false);
    expect(GameInviteResultSchema.safeParse({ invited: [] }).success).toBe(false);
  });
});
