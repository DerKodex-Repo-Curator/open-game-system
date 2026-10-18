import {
  CastButton,
  CastProvider,
  CastStatus,
  useCastViewUrl,
} from "@open-game-system/cast-kit-react";
import type { ReactNode } from "react";
import { inOwnApp } from "./in-own-app";

/**
 * Casting, from your phone page. The button is yours (style it like your game); the app gives it
 * the native Chromecast picker and session through the app bridge. The TV shows your manifest's
 * `tvUrl` full screen.
 *
 * It renders nothing in a plain browser (no app), when no Chromecast is on the network, and
 * inside the OGS app: there OGS casts once for every game, so a game never shows a cast button.
 */
export function TvCasting({ tvUrl, children }: { tvUrl: string | null; children?: ReactNode }) {
  if (!inOwnApp()) return <>{children}</>;
  return (
    <CastProvider>
      <TvPage url={tvUrl} />
      <PlayOnTvButton />
      {children}
    </CastProvider>
  );
}

/** Which page the TV shows (a room game's TV page for this room); null keeps the manifest's tvUrl. */
function TvPage({ url }: { url: string | null }) {
  useCastViewUrl(url);
  return null;
}

export function PlayOnTvButton() {
  return (
    <>
      <CastButton>
        {({ status, deviceName }, { showPicker, stopCasting }) =>
          status === "connected" ? (
            <button type="button" className="tv-button on" onClick={stopCasting}>
              On {deviceName ?? "the TV"} · Stop
            </button>
          ) : (
            <button
              type="button"
              className="tv-button"
              onClick={showPicker}
              disabled={status === "connecting"}
            >
              {status === "connecting" ? "Connecting…" : "Play on TV"}
            </button>
          )
        }
      </CastButton>
      <CastStatus>{({ error }) => (error ? <p role="alert">{error}</p> : null)}</CastStatus>
    </>
  );
}
