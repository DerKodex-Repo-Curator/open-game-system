# cast-kit reference

A room game's host phone uses cast-kit for one thing: telling OGS which page the TV should show
(`SET_VIEW_URL`). OGS does the casting itself, so a game never calls the other cast events and shows
no cast button: inside OGS the app ignores them. A game with a static `tvUrl` in its manifest needs
no cast-kit at all.

Install: [Quickstart, step 1](quickstart.md#1-install-profile-kit) (`/pkg/cast-kit-core.tgz` without
React, `/pkg/cast-kit-react.tgz` with it). When to declare: [Quickstart, step 8](quickstart.md#8-room-games-declare-the-tv-page-from-the-phone).

## `@open-game-system/cast-kit-core`

| Export | What it does |
|---|---|
| `isOGSCastAvailable()` | `true` when the page runs inside the OGS app's WebView (the app bridge is there); `false` in a plain browser. Use it to choose between declaring the TV page and showing your own TV link |
| `getCastBridge()` | The app bridge for the `cast` store, or `null` outside a browser. `bridge.getStore("cast")` is `undefined` until the app has sent the store (a moment after load); `bridge.subscribe(listener)` fires when stores arrive |
| `dispatchCastEvent(event)` | Dispatches to the `cast` store if it is there yet; **dropped silently if not**. For `SET_VIEW_URL`, wait for the store (below) |
| `getCastState()`, `onCastStateChange(cb)` | The `cast` store's state; games rarely need it |
| `CastStateSchema`, `CastEventsSchema` | The zod schemas of the store's state and events |

The `cast` store's state, as the app sends it:

```ts
{
  isAvailable: boolean,
  devices: { id: string; name: string; type: "chromecast" | "airplay" }[],
  session: { status: "disconnected" | "connecting" | "connected", deviceId: string | null,
             deviceName: string | null, sessionId: string | null, streamSessionId: string | null },
  error: string | null,
  viewUrl: string | null, // the TV page you declared
}
```

Declaring the TV page, waiting for the store:

```ts
import { getCastBridge, isOGSCastAvailable } from "@open-game-system/cast-kit-core";

export function declareTvPage(url: string) {
  const bridge = getCastBridge();
  if (!bridge || !isOGSCastAvailable()) return;
  const send = () => {
    const store = bridge.getStore("cast");
    store?.dispatch({ type: "SET_VIEW_URL", url });
    return Boolean(store);
  };
  if (send()) return;
  const off = bridge.subscribe(() => {
    if (send()) off();
  });
}
```

`url` must be an absolute URL (`z.string().url()`). Only the hosting phone's declaration counts: a
phone that followed the TV into the room (opened with `ogsRoom`) declares nothing.

## `@open-game-system/cast-kit-react`

| Export | What it does |
|---|---|
| `CastProvider` | Provides the `cast` store to the hooks. Renders nothing outside the OGS app |
| `useCastViewUrl(url)` | Declares the TV page (`SET_VIEW_URL`) once the store is there, and again when `url` changes. `null` declares nothing |
| `useCastAvailable()`, `useCastStatus()`, `useCastState()` | Read the store; games rarely need them |
| `CastButton`, `CastStatus` | For apps outside OGS. **Don't render them in an OGS game** |

```tsx
<CastProvider>
  <DeclareTv tvUrl={`${location.origin}/tv?room=${code}`} />
</CastProvider>
```

## Testing

Give the fake WebView a `cast` store with the state above and assert the
`{ type: "EVENT", storeKey: "cast", event: { type: "SET_VIEW_URL", url } }` it sends:
[Testing your game](testing.md#2-the-phone-page-in-a-fake-webview).
