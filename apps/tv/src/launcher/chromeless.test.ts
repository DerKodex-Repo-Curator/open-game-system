import type { CurrentGame, Manifest } from "@open-game-system/ogs-protocol";
import { describe, expect, it } from "vitest";
import { chromelessView } from "./chromeless";

/** What a chrome=none TV shows (docs/acceptance/2026-10-18-cast-chrome-none.feature). */
const current = (over: Partial<CurrentGame> = {}): CurrentGame => ({
  appId: "rocket-crew",
  instanceId: "i1",
  mode: "new",
  roster: [],
  label: "Rocket Crew",
  startedAt: 1,
  viewUrl: "https://rocket-crew.example/tv/ABCD",
  hostDeviceId: "phone-1",
  ...over,
});
const manifest = (tvUrl?: string): Pick<Manifest, "tvUrl"> => (tvUrl ? { tvUrl } : {});

describe("chromelessView", () => {
  it("the session's game, once it has a TV page, is framed (it gets ogs:start with the couch)", () => {
    expect(chromelessView("rocket-crew", current(), manifest("https://rocket-crew.example/tv"))).toEqual({ kind: "frames" });
  });
  it("before that, the manifest's tvUrl full screen", () => {
    expect(chromelessView("rocket-crew", null, manifest("https://rocket-crew.example/tv"))).toEqual({ kind: "tv-url", url: "https://rocket-crew.example/tv" });
    expect(chromelessView("rocket-crew", current({ viewUrl: null }), manifest("https://rocket-crew.example/tv"))).toEqual({ kind: "tv-url", url: "https://rocket-crew.example/tv" });
  });
  it("no tvUrl and no TV page yet: black", () => {
    expect(chromelessView("rocket-crew", null, manifest())).toEqual({ kind: "black" });
    expect(chromelessView("rocket-crew", null, null)).toEqual({ kind: "black" });
  });
  it("another game in the session isn't this app's: black, never another game's page", () => {
    expect(chromelessView("rocket-crew", current({ appId: "codebreakers" }), manifest())).toEqual({ kind: "black" });
  });
});
