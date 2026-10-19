import type { Store } from "@open-game-system/app-bridge-types";
import type { ProfileBridgeState, ProfileLogin } from "@open-game-system/ogs-protocol";
import type { ProfileEvents } from "./game-profile";

/**
 * The `profile` store as a single-game app gives it: a ready profile also says how the player is
 * signed in (`login`: guest, apple or google; ProfileLoginSchema). The login is read when the
 * profile becomes ready, which happens again after each sign-in. Snapshots are stable while
 * nothing changed.
 */
export function profileWithLogin(
  inner: Store<ProfileBridgeState, ProfileEvents>,
  login: () => ProfileLogin | null,
): Store<ProfileBridgeState, ProfileEvents> {
  let last: {
    from: ProfileBridgeState;
    login: ProfileLogin | null;
    out: ProfileBridgeState;
  } | null = null;
  const decorate = (from: ProfileBridgeState): ProfileBridgeState => {
    const now = login();
    if (last && last.from === from && last.login === now) return last.out;
    const out: ProfileBridgeState =
      from.status === "ready" && now ? { ...from, profile: { ...from.profile, login: now } } : from;
    last = { from, login: now, out };
    return out;
  };
  return {
    getSnapshot: () => decorate(inner.getSnapshot()),
    subscribe: (listener) => inner.subscribe((state) => listener(decorate(state))),
    dispatch: (event) => inner.dispatch(event),
    reset: () => inner.reset(),
    on: (type, listener) => inner.on(type, listener),
  };
}
