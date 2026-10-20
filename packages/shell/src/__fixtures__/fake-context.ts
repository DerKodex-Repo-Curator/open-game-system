import { createShellRequest } from "../api-client";
import type { FetchLike } from "../api-request";
import { createCastPicker } from "../cast-picker";
import type { ShellIdentity } from "../shell-identity";
import type { ShellContext, ShellRuntimeConfig } from "../shell-runtime";

/** A ShellContext without the runtime (tests only): identity and stop are driven by hand. */
export function fakeContext(fetch: FetchLike, config: Partial<ShellRuntimeConfig> = {}) {
  let identity: ShellIdentity | null = null;
  const identityListeners = new Set<(id: ShellIdentity | null) => void>();
  const stopListeners: (() => void)[] = [];
  const full: ShellRuntimeConfig = {
    appId: "rocket-crew",
    gameUrl: "https://play.rocketcrew.tv/phone",
    name: "Rocket Crew",
    apiBase: "https://api.test",
    linkDomains: [],
    ...config,
  };
  const ctx: ShellContext = {
    config: full,
    request: createShellRequest({ baseUrl: full.apiBase, fetch }),
    apiOptions: {
      baseUrl: full.apiBase,
      fetch,
      auth: () => (identity ? { token: identity.deviceToken } : null),
    },
    getIdentity: () => identity,
    onIdentity(listener) {
      identityListeners.add(listener);
      return () => {
        identityListeners.delete(listener);
      };
    },
    requestPush: async () => "registered",
    onStop: (listener) => {
      stopListeners.push(listener);
    },
    castPicker: createCastPicker(),
  };
  return {
    ctx,
    setIdentity(next: ShellIdentity | null) {
      identity = next;
      for (const l of identityListeners) l(next);
    },
    stop: () => {
      for (const l of stopListeners) l();
    },
  };
}
