import { inviteGame } from "../invite-family";

// 2026-10-18-invite-another-family.feature: the end of a session invites another family to the game
// this household played last.
const games = [
  { appId: "rocket-crew", name: "Rocket Crew" },
  { appId: "bake-shop", name: "Bake Shop" },
];
const sitting = (appId: string, updatedAt: number) => ({ appId, updatedAt });

describe("which game an invite is for", () => {
  it("the one played last", () => {
    expect(inviteGame([sitting("bake-shop", 1), sitting("rocket-crew", 5)], games)).toEqual({
      appId: "rocket-crew",
      name: "Rocket Crew",
    });
  });

  it("none before anything was played, or for a game not in the catalogue", () => {
    expect(inviteGame([], games)).toBeNull();
    expect(inviteGame([sitting("gone", 9)], games)).toBeNull();
  });
});
