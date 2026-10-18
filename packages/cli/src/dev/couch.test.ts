import {
  GamePlayerSchema,
  GameTokenSchema,
  LauncherToGameSchema,
  ManifestSchema,
  ProfileBridgeStateSchema,
} from "@open-game-system/ogs-protocol";
import { describe, expect, it } from "vitest";
import { fakeCouch, phoneClaims, profileState, startMessage, tvClaims } from "./couch";

const manifest = ManifestSchema.parse({
  appId: "fixture-game",
  name: "Fixture Game",
  shape: "couch",
  tv: "required",
  startUrl: "http://localhost:5173/",
  tvUrl: "http://localhost:5173/tv",
  roles: [
    { id: "captain", label: "Captain", audience: "grownup" },
    { id: "crew", label: "Crew", audience: "kid" },
  ],
  art: { tile: "/tile.png" },
});
const NOW = 1_800_000_000_000;
const ISS = "http://localhost:4747";

describe("ogs dev fake couch", { timeout: 20_000 }, () => {
  it("has one valid OGS player per phone, with distinct ids", () => {
    const couch = fakeCouch(manifest, 3);
    expect(couch.players).toHaveLength(3);
    for (const p of couch.players) expect(GamePlayerSchema.parse(p)).toEqual(p);
    expect(new Set(couch.players.map((p) => p.id)).size).toBe(3);
    expect(couch.label).toBe(couch.players[0].name);
  });

  it("seats players in the manifest's roles, in order, wrapping", () => {
    const couch = fakeCouch(manifest, 3);
    expect(couch.roster).toEqual([
      { profileId: couch.players[0].id, roleId: "captain" },
      { profileId: couch.players[1].id, roleId: "crew" },
      { profileId: couch.players[2].id, roleId: "captain" },
    ]);
  });

  it("gives a game without roles the role 'player'", () => {
    const couch = fakeCouch({ ...manifest, roles: [] }, 1);
    expect(couch.roster[0].roleId).toBe("player");
  });

  it("makes a new sitting each run", () => {
    expect(fakeCouch(manifest, 1).instanceId).not.toBe(fakeCouch(manifest, 1).instanceId);
    expect(fakeCouch(manifest, 1).sid).not.toBe(fakeCouch(manifest, 1).sid);
  });

  it("signs the TV a session token: aud = appId, the host as sub, sid, players and couch", () => {
    const couch = fakeCouch(manifest, 2);
    const claims = GameTokenSchema.parse(tvClaims(couch, manifest.appId, ISS, NOW));
    expect(claims).toMatchObject({
      iss: ISS,
      aud: "fixture-game",
      sub: couch.players[0].id,
      name: couch.players[0].name,
      sid: couch.sid,
      players: couch.players,
      couch: { sid: couch.sid, label: couch.label },
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
  });

  it("signs each phone its own profile token on the couch, with no players list", () => {
    const couch = fakeCouch(manifest, 2);
    const claims = GameTokenSchema.parse(phoneClaims(couch, 1, manifest.appId, ISS, NOW));
    expect(claims).toMatchObject({
      aud: "fixture-game",
      sub: couch.players[1].id,
      handle: couch.players[1].handle,
      couch: { sid: couch.sid, label: couch.label },
    });
    expect(claims.players).toBeUndefined();
    expect(claims.sid).toBeUndefined();
  });

  it("builds ogs:start as the launcher does (startMessage with a grant)", () => {
    const couch = fakeCouch(manifest, 2);
    const msg = LauncherToGameSchema.parse(startMessage(couch, "tok"));
    expect(msg).toEqual({
      type: "ogs:start",
      instanceId: couch.instanceId,
      mode: "new",
      roster: couch.roster,
      token: "tok",
      players: couch.players,
    });
  });

  it("gives the phone's profile store the ready state profile-kit reads", () => {
    const couch = fakeCouch(manifest, 1);
    const state = ProfileBridgeStateSchema.parse(profileState(couch.players[0], "tok"));
    expect(state).toEqual({ status: "ready", profile: { ...couch.players[0], token: "tok" } });
  });
});
