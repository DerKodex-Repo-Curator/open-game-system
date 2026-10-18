import { randomUUID } from "node:crypto";
import {
  GAME_TOKEN_TTL_S,
  type GamePlayer,
  type GameToken,
  type LauncherToGame,
  type Manifest,
  type ProfileBridgeState,
  type RosterEntry,
} from "@open-game-system/ogs-protocol";

/** The couch `ogs dev` pretends is sitting in front of the TV: one player per phone frame. */
export type DevCouch = {
  /** The couch session id (`sid` in tokens). */
  sid: string;
  /** The couch's label: the host's name, as OGS labels a couch. */
  label: string;
  /** The OGS sitting the TV page is started for. */
  instanceId: string;
  players: GamePlayer[];
  roster: RosterEntry[];
};

const NAMES = ["Ada", "Sam", "Rae", "Kit", "Lou", "Ivo"];
const COLORS = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#4c956c", "#9d4edd"];
export const MAX_PHONES = NAMES.length;

/** A plain coloured disc with the player's initial (a data URL: loads on a real phone too). */
const avatar = (name: string, color: string) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${color}"/><text x="32" y="42" font-family="sans-serif" font-size="30" text-anchor="middle" fill="#fff">${name[0]}</text></svg>`,
  ).toString("base64")}`;

export function fakeCouch(manifest: Manifest, phones: number): DevCouch {
  const run = randomUUID().slice(0, 8);
  const players = Array.from({ length: phones }, (_, i): GamePlayer => {
    const name = NAMES[i % NAMES.length];
    return {
      id: `dev-${run}-${i + 1}`,
      handle: name.toLowerCase(),
      name,
      avatar: avatar(name, COLORS[i % COLORS.length]),
    };
  });
  const roles = manifest.roles.map((r) => r.id);
  return {
    sid: `dev-couch-${run}`,
    label: players[0]?.name ?? "ogs dev",
    instanceId: `dev-sitting-${run}`,
    players,
    roster: players.map((p, i) => ({
      profileId: p.id,
      roleId: roles.length ? roles[i % roles.length] : "player",
    })),
  };
}

const times = (now: number) => {
  const iat = Math.floor(now / 1000);
  return { iat, exp: iat + GAME_TOKEN_TTL_S };
};

const playerClaims = (p: GamePlayer) => ({
  sub: p.id,
  handle: p.handle,
  name: p.name,
  avatar: p.avatar,
});

/** The TV's session token (as POST /sessions/:sid/game-token signs it): the host, the couch, its players. */
export function tvClaims(couch: DevCouch, appId: string, iss: string, now: number): GameToken {
  const host = couch.players[0];
  return {
    iss,
    aud: appId,
    ...playerClaims(host),
    sid: couch.sid,
    players: couch.players,
    couch: { sid: couch.sid, label: couch.label },
    ...times(now),
  };
}

/** One phone's profile token for this game, issued with its couch. */
export function phoneClaims(
  couch: DevCouch,
  index: number,
  appId: string,
  iss: string,
  now: number,
): GameToken {
  return {
    iss,
    aud: appId,
    ...playerClaims(couch.players[index]),
    couch: { sid: couch.sid, label: couch.label },
    ...times(now),
  };
}

/** ogs:start as the TV launcher sends it with a grant (apps/tv/src/launcher/frames.ts startMessage). */
export function startMessage(couch: DevCouch, token: string): LauncherToGame {
  return {
    type: "ogs:start",
    instanceId: couch.instanceId,
    mode: "new",
    roster: couch.roster,
    token,
    players: couch.players,
  };
}

/** The `profile` bridge store's state once the app has the game token. */
export function profileState(player: GamePlayer, token: string): ProfileBridgeState {
  return { status: "ready", profile: { ...player, token } };
}
