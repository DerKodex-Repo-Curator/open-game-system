import { createApiRequest } from "./api-request";
import { createGameNotifications } from "./game-notifications";
import { createGameProfile, createGameTokenClient } from "./game-profile";
import { createOgsBridgeStore } from "./ogs-bridge";
import { createPushApi } from "./push-api";
import type { ShellContext } from "./shell-runtime";

export interface OgsGameStoresOptions {
  /** The shell's own question before the OS prompt (the consent sheet's askToNotify on a device). */
  askPlayer: (gameName: string) => Promise<boolean>;
}

/**
 * The OGS app's game stores, for the one game of a single-game app: `profile` (a game token for
 * this game, asked again after each sign-in), `notifications` (REQUEST → the shell's prompt → the
 * OS prompt → this device registered for native push → a push handle), `ogs` (sitting reports).
 */
export function ogsGameStores(opts: OgsGameStoresOptions) {
  return (ctx: ShellContext) => {
    const { appId, name } = ctx.config;
    const profile = createGameProfile({ fetchToken: createGameTokenClient(ctx.apiOptions) });
    ctx.onIdentity((identity) => {
      profile.close();
      if (identity) profile.open(appId);
    });

    const pushApi = createPushApi(ctx.apiOptions);
    const notifications = createGameNotifications({
      appId: () => appId,
      gameName: () => name,
      // A single-game app is the game's own app: no kid-device rule of its own (the game decides).
      isKidDevice: () => false,
      alreadyAllowed: async (id) => (await pushApi.grantedGames()).includes(id),
      askPlayer: opts.askPlayer,
      osPermission: async () => (await ctx.requestPush()) === "registered",
      optIn: (id, join) => pushApi.optIn(id, join),
    });

    const { request } = createApiRequest(ctx.apiOptions);
    const ogs = createOgsBridgeStore(async (report, source) => {
      await request("/api/v1/me/instances", {
        method: "POST",
        body: { ...report, source },
        authed: true,
      });
    });

    return { profile: profile.store, notifications: notifications.store, ogs };
  };
}
