import { describe, expect, it } from "vitest";
import {
  CouchInviteBodySchema,
  CouchInvitePushDataSchema,
  CouchInviteResultSchema,
  couchInviteLink,
  RecentPlayersSchema,
} from "./couch-invite";

// Invite last week's players (docs/acceptance/2026-10-18-second-visit.feature).
describe("couch invites", () => {
  it("the push opens the couch's join page", () => {
    expect(couchInviteLink("nownow")).toBe("https://opengame.org/join/NOWNOW");
    const data = { type: "couch-invite", url: "https://opengame.org/join/NOWNOW" };
    expect(CouchInvitePushDataSchema.parse(data)).toEqual(data);
  });

  it("a push that points anywhere but a join page isn't a couch invite", () => {
    for (const url of [
      "https://evil.example/join/NOWNOW",
      "https://opengame.org/play/x",
      "opengame://join/NOWNOW",
    ])
      expect(CouchInvitePushDataSchema.safeParse({ type: "couch-invite", url }).success).toBe(
        false,
      );
    expect(
      CouchInvitePushDataSchema.safeParse({
        type: "game-push",
        url: "https://opengame.org/join/NOWNOW",
      }).success,
    ).toBe(false);
  });

  it("the body is 1 to 20 profile ids", () => {
    expect(CouchInviteBodySchema.safeParse({ profileIds: ["lee"] }).success).toBe(true);
    for (const profileIds of [[], Array(21).fill("x"), [""], "lee"])
      expect(CouchInviteBodySchema.safeParse({ profileIds }).success).toBe(false);
  });

  it("parses the players list and the result", () => {
    const players = {
      players: [{ profileId: "lee", name: "Lee", sticker: "owl", reachable: true }],
    };
    expect(RecentPlayersSchema.parse(players)).toEqual(players);
    expect(CouchInviteResultSchema.parse({ invited: ["lee"], skipped: [] })).toEqual({
      invited: ["lee"],
      skipped: [],
    });
  });
});
