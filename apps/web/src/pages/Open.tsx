import { readOpenLink } from "@open-game-system/ogs-protocol";
import { useLocation } from "react-router-dom";
import Footer from "@/components/Footer";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";

/** Where a phone without the app gets it (the TestFlight public link while OGS is in beta). */
const GET_APP = import.meta.env.VITE_OGS_GET_APP;

/**
 * opengame.org/open?url=<game page> opened without the OGS app (with it, iOS opens the app): open
 * the game in the app, or play its page right here in the browser. It was a 404.
 */
const Open = () => {
  const location = useLocation();
  const link = readOpenLink(`https://opengame.org${location.pathname}${location.search}`);

  return (
    <div className="flex flex-col min-h-screen">
      <NavBar />
      <div className="flex-grow flex items-center justify-center section-padding">
        <div className="text-center max-w-md" data-testid="open-link">
          {link ? (
            <>
              <h1 className="text-3xl font-bold mb-4">Open this game</h1>
              <p className="text-muted-foreground mb-8">{link.host}</p>
              <Button asChild className="w-full mb-3">
                <a data-testid="open-in-app" href={link.app}>
                  Open in the OGS app
                </a>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <a data-testid="open-in-browser" href={link.page}>
                  Play in this browser
                </a>
              </Button>
              <p className="text-muted-foreground mt-6 text-sm" data-testid="open-get-app">
                {GET_APP ? (
                  <>
                    No OGS app yet?{" "}
                    <a className="underline font-medium" href={GET_APP}>
                      Get OGS
                    </a>{" "}
                    to play it on your TV.
                  </>
                ) : (
                  "The OGS app is in beta. Play in the browser now, or ask a friend for an invite."
                )}
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

export default Open;
