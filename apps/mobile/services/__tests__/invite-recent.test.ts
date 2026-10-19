import { inviteRecentRows } from "../invite-recent";

// 2026-10-18-second-visit.feature, "Invite last week's players": the sheet's rows.
const lee = { profileId: "lee", name: "Lee", sticker: "owl", reachable: true };
const june = { profileId: "june", name: "June", sticker: "dragon", reachable: false };
const sam = { profileId: "sam", name: "Sam", sticker: "whale", reachable: true };

describe("inviteRecentRows", () => {
  it("offers Invite to whoever OGS can notify, says so for whoever it can't", () => {
    expect(inviteRecentRows([lee, june], new Set())).toEqual([
      { profileId: "lee", name: "Lee", sticker: "owl", state: "invite" },
      { profileId: "june", name: "June", sticker: "dragon", state: "unreachable" },
    ]);
  });

  it("shows Invited once the invite went out (or OGS had already sent one tonight)", () => {
    const rows = inviteRecentRows([lee, sam], new Set(["sam"]));
    expect(rows.map((r) => r.state)).toEqual(["invite", "invited"]);
  });

  it("is empty when nobody shared a couch this week", () => {
    expect(inviteRecentRows([], new Set())).toEqual([]);
  });
});
