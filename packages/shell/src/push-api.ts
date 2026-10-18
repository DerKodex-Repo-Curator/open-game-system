import { type PushConsentResult, PushConsentResultSchema } from "@open-game-system/ogs-protocol";
import { z } from "zod";
import { createApiRequest, OgsApiError, type OgsApiOptions } from "./api-request";

const GrantsSchema = z.object({ games: z.array(z.string()) });

/** The app's side of game pushes (spec §9): consent, Settings, and which surface was used last. */
export function createPushApi(opts: OgsApiOptions) {
  const { request, parse } = createApiRequest(opts);
  const path = (appId: string) => encodeURIComponent(appId);
  return {
    /** The player allowed the game: the handle that reaches them (joining `join` when given). */
    async optIn(appId: string, join?: string): Promise<PushConsentResult> {
      const body = join ? { handle: join } : {};
      const raw = await request(`/api/v1/games/${path(appId)}/push-handles`, {
        method: "POST",
        authed: true,
        body,
      });
      // ogs-protocol's schemas are zod 3, the app's parse helper zod 4: check it here.
      const r = PushConsentResultSchema.safeParse(raw);
      if (!r.success) throw new OgsApiError("BAD_RESPONSE", r.error.message, 0);
      return r.data;
    },
    async grantedGames(): Promise<string[]> {
      return parse(GrantsSchema, await request("/api/v1/me/push-grants", { authed: true })).games;
    },
    async revoke(appId: string): Promise<void> {
      await request(`/api/v1/me/push-grants/${path(appId)}`, { method: "DELETE", authed: true });
    },
    /** The game opened here: pushes for it prefer this phone's app over the game's PWA. */
    async active(appId: string): Promise<void> {
      await request(`/api/v1/me/push-active/${path(appId)}`, { method: "POST", authed: true });
    },
  };
}
