import { readGameLink, readPlayLink, reportInviteStep } from "@open-game-system/ogs-protocol";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Footer from "@/components/Footer";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";

/** The OGS API (the invite's counts); production unless the build says. */
const API = import.meta.env.VITE_OGS_API ?? "https://opengame-api.jonathanrmumm.workers.dev";
/** Where a phone without the app gets it (the TestFlight public link while OGS is in beta). */
const GET_APP = import.meta.env.VITE_OGS_GET_APP;
const post = (url: string, init: RequestInit) => fetch(url, init);

/** The TV page a browser TV opens (the build's launcher; ogs-tv.pages.dev in production). */
const TV_ADDRESS = new URL(import.meta.env.VITE_OGS_TV ?? "https://ogs-tv.pages.dev").host;

/** "night-flight" → "Night Flight" (the page has no catalogue; the app names it properly). */
const gameName = (appId: string) =>
  appId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * An invite to a game's room (spec §7: opengame.org/play/<appId>?room=<room>) opened without the
 * OGS app: open it in the app (opengame://play/…), or say how to get the app. Without a room it is a
 * game link: open that game in the app.
 */
const Play = () => {
  const location = useLocation();
  const url = `https://opengame.org${location.pathname}${location.search}`;
  const link = readPlayLink(url);
  // No room: a game link ("Play on your TV" from a game's site or the front door).
  const game = link ? null : readGameLink(url);
  const inv = game?.inv;

  // Another family's invite: this page opening is funnel.link_opened (once per visit).
  useEffect(() => {
    if (inv) void reportInviteStep(API, inv, "link_opened", post);
  }, [inv]);

  return (
    <div className="flex flex-col min-h-screen">
      <NavBar />
      <div className="flex-grow flex items-center justify-center section-padding">
        <div className="text-center max-w-md" data-testid="play-invite">
          {link ? (
            <>
              <h1 className="text-4xl font-bold mb-4">{gameName(link.appId)}</h1>
              <p className="text-lg mb-2">
                You're invited to play together, each family on its own TV.
              </p>
              <p className="text-muted-foreground mb-8">Room {link.room}</p>
              <Button asChild>
                <a
                  data-testid="open-in-app"
                  href={`opengame://play/${link.appId}?room=${encodeURIComponent(link.room)}`}
                >
                  Open in the OGS app
                </a>
              </Button>
              <p className="text-muted-foreground mt-6 text-sm">
                No OGS app yet? Get it from the App Store, then tap this link again.
              </p>
            </>
          ) : game ? (
            <>
              <h1 className="text-4xl font-bold mb-4">{gameName(game.appId)}</h1>
              <p className="text-lg mb-8">Play it on your TV with the OGS app.</p>
              <Button asChild>
                <a
                  data-testid="open-in-app"
                  href={`opengame://play/${game.appId}${inv ? `?inv=${inv}` : ""}`}
                >
                  Open in the OGS app
                </a>
              </Button>
              {GET_APP ? (
                <Button asChild variant="outline" className="mt-3">
                  <a
                    data-testid="get-app"
                    href={GET_APP}
                    onClick={() => {
                      if (inv) void reportInviteStep(API, inv, "testflight_tap", post);
                    }}
                  >
                    No app yet? Get OGS
                  </a>
                </Button>
              ) : (
                <p className="text-muted-foreground mt-3 text-sm">
                  The OGS app is in beta: ask whoever sent this for an invite.
                </p>
              )}
              <p className="text-muted-foreground mt-6 text-sm">
                No Chromecast? Any TV with a browser works: open {TV_ADDRESS} on it.
              </p>
            </>
          ) : (
            <p className="text-lg">That link doesn't name a game.</p>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Play;
