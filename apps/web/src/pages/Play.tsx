import { readGameLink, readPlayLink } from "@open-game-system/ogs-protocol";
import { useLocation } from "react-router-dom";
import Footer from "@/components/Footer";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";

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
                <a data-testid="open-in-app" href={`opengame://play/${game.appId}`}>
                  Open in the OGS app
                </a>
              </Button>
              <p className="text-muted-foreground mt-6 text-sm">
                No Chromecast? Any TV with a browser works: open ogs-tv.pages.dev on it.
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
