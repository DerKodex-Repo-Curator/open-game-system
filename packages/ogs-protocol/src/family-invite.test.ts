import { describe, expect, it } from "vitest";
import {
  FamilyInviteSchema,
  FunnelStepSchema,
  familyInviteLink,
  InviteIdSchema,
  InviteStatsSchema,
  reportInviteStep,
} from "./family-invite";
import { readGameLink } from "./rooms";

// Acceptance: 2026-10-18-invite-another-family.feature. At the end of a session the host invites
// another household to a game: a link that names the game and the invite, so each step of the new
// household's way in (link opened, TestFlight tapped, first couch) counts toward that invite.
const INV = "6f0c2a9e-1b7d-4c3e-9a51-2f1d8c7b0e44";

describe("an invite another family link", () => {
  it("is the game link with the invite: opengame.org/play/<appId>?inv=<id>", () => {
    expect(familyInviteLink("https://opengame.org///", "rocket-crew", INV)).toBe(
      `https://opengame.org/play/rocket-crew?inv=${INV}`,
    );
  });

  it("reads back as the game and the invite (in the app's scheme too)", () => {
    expect(readGameLink(`https://opengame.org/play/rocket-crew?inv=${INV}`)).toEqual({
      appId: "rocket-crew",
      inv: INV,
    });
    expect(readGameLink(`opengame://play/rocket-crew?utm=x&inv=${INV}`)).toEqual({
      appId: "rocket-crew",
      inv: INV,
    });
  });

  it("an invite id is exactly a UUID", () => {
    expect(InviteIdSchema.safeParse(INV).success).toBe(true);
    for (const bad of [`x${INV}`, `${INV}x`, INV.toUpperCase()])
      expect(InviteIdSchema.safeParse(bad).success).toBe(false);
  });

  it("an inv that isn't an invite id is left out", () => {
    expect(readGameLink("https://opengame.org/play/rocket-crew?inv=nope")).toEqual({
      appId: "rocket-crew",
    });
  });
});

describe("the invite's answers", () => {
  it("a new invite: its id and link", () => {
    const ok = { inviteId: INV, link: `https://opengame.org/play/rocket-crew?inv=${INV}` };
    expect(FamilyInviteSchema.parse(ok)).toEqual(ok);
    expect(FamilyInviteSchema.safeParse({ ...ok, inviteId: "x" }).success).toBe(false);
  });

  it("its counts: opened, TestFlight taps, and whether they played", () => {
    const stats = { appId: "rocket-crew", opened: 2, testflightTaps: 1, firstSession: true };
    expect(InviteStatsSchema.parse(stats)).toEqual(stats);
    expect(InviteStatsSchema.safeParse({ ...stats, opened: -1 }).success).toBe(false);
  });

  it("the steps a page reports", () => {
    expect(FunnelStepSchema.options).toEqual(["link_opened", "testflight_tap"]);
  });
});

describe("the page reporting a step", () => {
  it("posts it to the invite, keepalive (the page may be leaving for TestFlight)", async () => {
    const sent: { url: string; init: unknown }[] = [];
    await reportInviteStep("https://api.test///", INV, "testflight_tap", async (url, init) => {
      sent.push({ url, init });
    });
    expect(sent).toEqual([
      {
        url: `https://api.test/api/v1/family-invites/${INV}/events`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "testflight_tap" }),
          keepalive: true,
        },
      },
    ]);
  });

  it("never throws: a lost count mustn't stop the page", async () => {
    await expect(
      reportInviteStep("https://api.test", INV, "link_opened", async () => {
        throw new TypeError("offline");
      }),
    ).resolves.toBeUndefined();
  });
});
