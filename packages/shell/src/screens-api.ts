import { z } from "zod";
import type { ShellRequest } from "./api-client";
import type { ScreensApi } from "./screen-cast";
import type { ShellIdentity } from "./shell-identity";

/** POST /api/v1/screens/claim (ogs-protocol ScreenClaimedSchema; zod 4 here). */
const ScreenClaimedSchema = z.object({ screenId: z.string().min(1), name: z.string() });
const NoContentSchema = z.unknown();

/**
 * Browser TVs for a single-game app, on the OGS API with the shell's device token (guest or signed
 * in): claim a screen by its code, show a launcher on it (with `app` for a chromeless cast), stop.
 */
export function createShellScreensApi(deps: {
  request: ShellRequest;
  getIdentity: () => ShellIdentity | null;
}): ScreensApi {
  const token = () => {
    const identity = deps.getIdentity();
    if (!identity) throw new Error("No OGS profile yet: a browser TV needs one");
    return identity.deviceToken;
  };
  const screen = (id: string) => `/api/v1/screens/${encodeURIComponent(id)}`;
  return {
    claim: async (code) =>
      deps.request(ScreenClaimedSchema, "/api/v1/screens/claim", {
        method: "POST",
        body: { code },
        token: token(),
      }),
    async show(screenId, launcherToken, app) {
      await deps.request(NoContentSchema, `${screen(screenId)}/show`, {
        method: "POST",
        body: app ? { token: launcherToken, app } : { token: launcherToken },
        token: token(),
      });
    },
    async stop(screenId) {
      await deps.request(NoContentSchema, `${screen(screenId)}/stop`, {
        method: "POST",
        token: token(),
      });
    },
  };
}
