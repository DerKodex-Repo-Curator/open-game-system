import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { boot } from "../boot";
import { createPairing, type PairingView, screenLauncherParams } from "../screen/pairing";
import { App } from "./App";
import { Stage } from "./Stage";

/** How often a screen asks what to show (a phone's cast, or its stop). */
const POLL_MS = 2000;

/**
 * A browser on the TV as an OGS TV (2026-10-17-browser-tv.feature): its code until a phone casts,
 * then that couch's launcher, run right here (no cloud stream); the code again when it stops.
 */
export function ScreenApp({ api, search }: { api: string; search: string }) {
  const pairing = useMemo(
    () => createPairing({ api, fetch: (u, i) => fetch(u, i), storage: window.localStorage }),
    [api],
  );
  const view = useSyncExternalStore(pairing.subscribe, pairing.view);

  // Polling the API is the sync with an outside system (an interval is the event source).
  useEffect(() => {
    void pairing.tick();
    const t = setInterval(() => void pairing.tick(), POLL_MS);
    return () => clearInterval(t);
  }, [pairing]);

  return view.kind === "launcher" ? (
    <Launcher key={`${view.token} ${view.app ?? ""}`} api={api} view={view} search={search} />
  ) : (
    <Pairing view={view} />
  );
}

function Launcher({
  api,
  view,
  search,
}: {
  api: string;
  view: Extract<PairingView, { kind: "launcher" }>;
  search: string;
}) {
  // The key remounts on a new token or app: this view is fixed for the component's life.
  const booted = useMemo(() => {
    const params = screenLauncherParams(api, view);
    return params ? boot(params, search) : null;
  }, [api, view, search]);
  return booted ? <App boot={booted} /> : <Pairing view={{ kind: "offline" }} />;
}

function Pairing({ view }: { view: Exclude<PairingView, { kind: "launcher" }> }) {
  const [full, setFull] = useState(false);
  return (
    <Stage>
      <div className="screen calm" data-testid="screen-pairing">
        <div className="calm-card pairing-card">
          <p className="eyebrow">OGS TV</p>
          {view.kind === "code" ? (
            <>
              <h1>Play on this TV</h1>
              <p className="pairing-step">
                Open OGS on your phone, then <b>TV › Use a browser TV</b>, and type
              </p>
              <p className="pairing-code" data-testid="screen-code">
                {view.code}
              </p>
            </>
          ) : view.kind === "offline" ? (
            <h1 data-testid="screen-offline">Can't reach OGS. Trying again…</h1>
          ) : (
            <h1>Getting a code…</h1>
          )}
          {full ? null : (
            <button
              type="button"
              className="pairing-full"
              data-testid="screen-fullscreen"
              onClick={() => {
                // One click also lets the games play sound (browsers block it until then).
                void document.documentElement.requestFullscreen?.().catch(() => {});
                setFull(true);
              }}
            >
              Click to go full screen
            </button>
          )}
        </div>
      </div>
    </Stage>
  );
}
