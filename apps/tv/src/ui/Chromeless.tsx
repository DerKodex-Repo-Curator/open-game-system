import type { Manifest, SessionState } from "@open-game-system/ogs-protocol";
import { chromelessView } from "../launcher/chromeless";
import type { StartGrant } from "../launcher/frames";
import type { SessionClient } from "../session/client";
import { useFrames } from "./useFrames";

/**
 * chrome=none (docs/acceptance/2026-10-18-cast-chrome-none.feature): only the game's TV page, full
 * screen, as a white-label app casts it. No home, game page, people, join code or OGS mark. The
 * session's frames still get ogs:start with the couch (useFrames, as in the launcher).
 */
export function Chromeless(props: {
  appId: string;
  client: SessionClient;
  state: SessionState | null;
  manifest: Manifest | null;
  frameTimeoutMs: number;
  grants: (appId: string) => Promise<StartGrant | null>;
}) {
  const current = props.state?.current ?? null;
  const ours = current?.appId === props.appId ? current : null;
  const frames = useFrames(props.client, ours, props.frameTimeoutMs, props.grants);
  const view = chromelessView(props.appId, current, props.manifest);
  const slot = frames.frames.active;
  return (
    <div className="chromeless" data-testid="chromeless" data-view={view.kind} style={{ position: "fixed", inset: 0, background: "#000" }}>
      {view.kind === "frames" && slot && (
        <iframe
          key={slot.instanceId}
          ref={(el) => frames.register(slot.instanceId, el)}
          data-testid="game-frame"
          data-app={slot.appId}
          title={slot.appId}
          src={slot.url}
          allow="autoplay; fullscreen"
          onLoad={() => frames.onLoad(slot)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      )}
      {view.kind === "tv-url" && (
        <iframe
          data-testid="tv-url-frame"
          title={props.appId}
          src={view.url}
          allow="autoplay; fullscreen"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      )}
    </div>
  );
}
