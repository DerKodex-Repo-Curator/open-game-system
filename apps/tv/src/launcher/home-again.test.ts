import type { Instance } from "@open-game-system/ogs-protocol";
import { describe, expect, it } from "vitest";
import { FIXTURE_GAMES } from "../session/fixture";
import { buildHome, homeFocusRows, homeStart, recoverFocus } from "./home";

// The second visit (docs/acceptance/2026-10-18-second-visit.feature, "Play again on the TV"): the
// game the household played last comes first on the TV, and OK starts a new game of it. A finished
// game leaves Continue after a day and a silent sitting after its TTL, so yesterday's game was only
// a Library icon in catalogue order.
const NOW = new Date(2026, 9, 18, 19, 0).getTime(); // a Sunday, 7 pm
const DAY = 24 * 60 * 60 * 1000;

const played = (appId: string, at: number, status: Instance["status"] = "completed"): Instance => ({
  profileId: "dana",
  instanceId: `${appId}-${at}`,
  appId,
  status,
  title: "",
  detail: "",
  source: "visit",
  updatedAt: at,
});

const home = (instances: Instance[], surpriseSeed = 0) =>
  buildHome({ games: FIXTURE_GAMES, instances, suspended: [], now: NOW, surpriseSeed });

describe("Play again: the last game played comes first on the TV", () => {
  it("yesterday's game is the first card, and OK on it starts a new game of it", () => {
    const h = home([played("night-flight", NOW - DAY), played("bake-shop", NOW - 3 * DAY)]);
    expect(h.cards[0]).toMatchObject({
      kind: "again",
      itemId: "play:night-flight",
      appId: "night-flight",
      name: "Night Flight",
      tag: "Play again",
      chip: "Yesterday",
    });
  });

  it("puts it first in the row of games too, tagged with when it was played", () => {
    const h = home([played("night-flight", NOW - DAY)]);
    expect(h.icons[0]).toMatchObject({ appId: "night-flight", tag: "Played yesterday" });
    expect(new Set(h.icons.map((i) => i.appId)).size).toBe(h.icons.length);
  });

  it("counts a sitting that was left silent past its TTL (7 days here), not only a finished game", () => {
    const h = home([played("story-nook", NOW - 9 * DAY, "active")]);
    expect(h.cards[0]).toMatchObject({ kind: "again", appId: "story-nook" });
  });

  it("is the latest game played, whichever profile order or status", () => {
    const h = home([played("bake-shop", NOW - 3 * DAY), played("night-flight", NOW - DAY)]);
    expect(h.cards[0]).toMatchObject({ appId: "night-flight" });
  });

  it("Surprise me then picks another game, so the two cards never start the same one", () => {
    for (const seed of [0, 0.3, 0.6, 0.99]) {
      const h = home([played("story-nook", NOW - DAY)], seed);
      const surprise = h.cards.find((c) => c.kind === "surprise");
      expect(surprise?.appId).not.toBe("story-nook");
      const ids = homeFocusRows(h).flatMap((r) => r.items);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("no Play again card while that game has a sitting to continue (Continue covers it)", () => {
    const paused = played("night-flight", NOW - 60 * 60 * 1000, "suspended");
    const h = home([paused]);
    expect(h.cards.some((c) => c.kind === "again")).toBe(false);
    expect(h.cards[0]).toMatchObject({ kind: "sitting", appId: "night-flight" });
  });

  it("forgets games played more than 30 days ago, and games no longer on this TV", () => {
    expect(
      home([played("night-flight", NOW - 31 * DAY)]).cards.some((c) => c.kind === "again"),
    ).toBe(false);
    expect(home([played("not-a-game", NOW - DAY)]).cards.some((c) => c.kind === "again")).toBe(
      false,
    );
  });

  it("a household that never played has no Play again", () => {
    expect(home([]).cards.map((c) => c.kind)).toEqual(["surprise"]);
  });
});

describe("the ring starts on Play again", () => {
  it("arriving home with a Play again card, the ring is on it: OK starts the game", () => {
    const h = home([played("night-flight", NOW - DAY)]);
    expect(recoverFocus(homeFocusRows(h), null, null, homeStart(h))).toBe("play:night-flight");
  });

  it("without one, the first icon as before", () => {
    const h = home([]);
    expect(homeStart(h)).toBeNull();
    expect(recoverFocus(homeFocusRows(h), null, null, homeStart(h))).toBe(h.icons[0]?.itemId);
  });

  it("a focus already on screen, or a page's game to return to, still wins", () => {
    const h = home([played("night-flight", NOW - DAY)]);
    const rows = homeFocusRows(h);
    expect(recoverFocus(rows, "game:bake-shop", null, homeStart(h))).toBeNull();
    expect(recoverFocus(rows, "action:new", "bake-shop", homeStart(h))).toBe("game:bake-shop");
  });
});
