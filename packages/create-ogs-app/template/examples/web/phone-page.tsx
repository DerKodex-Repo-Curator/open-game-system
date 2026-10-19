import { requestOgsNotifications } from "@open-game-system/profile-kit";
import { useState } from "react";
import { TvCasting } from "./cast-button";
import { PlayerBadge } from "./player-badge";

/**
 * A tiny phone page that uses all of it: the player, "Play on TV", and "Ping me when it's my turn".
 * The same page runs in your app, in the OGS app and in a plain browser.
 */
export function PhonePage({ room, saveHandle }: { room: string; saveHandle: (h: string) => void }) {
  const [ping, setPing] = useState<"ask" | "on" | "off">("ask");

  async function askForPings() {
    const answer = await requestOgsNotifications(); // from a tap; null outside an app
    if (answer?.status === "granted") {
      saveHandle(answer.handle); // keep it on the player's seat, on your server
      setPing("on");
    } else {
      setPing("off");
    }
  }

  return (
    <main>
      <PlayerBadge />
      <TvCasting tvUrl={`__OGS_GAME_ORIGIN__/tv?room=${encodeURIComponent(room)}`}>
        {ping === "ask" ? (
          <button type="button" onClick={askForPings}>
            Ping me when it's my turn
          </button>
        ) : null}
      </TvCasting>
    </main>
  );
}
