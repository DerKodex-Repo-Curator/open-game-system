import {
  appJoinLink,
  type GuestJoined,
  GuestJoinedSchema,
  type JoinLookup,
  loadJoin,
  normaliseTvCode,
  stickerArt,
} from "@open-game-system/ogs-protocol";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GuestCouch } from "./join/GuestCouch";
import { GuestForm } from "./join/GuestForm";

/** The OGS API and launcher (sticker art) this page reads; production unless the build says. */
const API = import.meta.env.VITE_OGS_API ?? "https://opengame-api.jonathanrmumm.workers.dev";
const LAUNCHER = import.meta.env.VITE_OGS_TV ?? "https://ogs-tv.pages.dev";
/** Where a phone without the app gets it (the TestFlight public link while OGS is in beta). */
const GET_APP = import.meta.env.VITE_OGS_GET_APP;

/**
 * opengame.org/join/<code>: where the TV's QR goes (spec ogs-join). With the app installed the
 * phone opens the app straight from the scan (universal link); this page is for a phone without
 * it, or a code typed at opengame.org/join.
 */
const Join = () => {
  const { code = "" } = useParams();
  const [lookup, setLookup] = useState<JoinLookup | "loading">(code ? "loading" : { kind: "bad" });

  useEffect(() => {
    if (!code) return;
    let live = true;
    setLookup("loading");
    void loadJoin(API, code, (url) => fetch(url)).then((r) => {
      if (live) setLookup(r);
    });
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-background">
      <div className="w-full max-w-sm text-center" data-testid="join-page">
        {lookup === "loading" ? (
          <p className="text-lg text-muted-foreground" data-testid="join-loading">
            Finding the couch…
          </p>
        ) : lookup.kind === "couch" ? (
          <Couch lookup={lookup} />
        ) : (
          <TypeCode lookup={lookup} typed={code} />
        )}
      </div>
    </main>
  );
};

/** A guest who joined from this tab stays joined across a reload (this tab only). */
const guestKey = (code: string) => `ogs.guest.${code}`;
function savedGuest(code: string): GuestJoined | null {
  try {
    const saved = GuestJoinedSchema.safeParse(
      JSON.parse(sessionStorage.getItem(guestKey(code)) ?? "null"),
    );
    return saved.success ? saved.data : null;
  } catch {
    return null;
  }
}

function Couch({ lookup }: { lookup: Extract<JoinLookup, { kind: "couch" }> }) {
  const { couch } = lookup;
  const [guest, setGuest] = useState<GuestJoined | null>(() => savedGuest(couch.code));
  const [joining, setJoining] = useState(false);
  if (guest) return <GuestCouch api={API} launcher={LAUNCHER} joined={guest} />;
  if (joining)
    return (
      <>
        <h1 className="text-3xl font-bold mb-6">Join {couch.host.name}'s couch</h1>
        <GuestForm
          api={API}
          launcher={LAUNCHER}
          code={couch.code}
          onJoined={(joined) => {
            try {
              sessionStorage.setItem(guestKey(joined.code), JSON.stringify(joined));
            } catch {}
            setGuest(joined);
          }}
        />
      </>
    );
  return (
    <>
      <p className="text-sm uppercase tracking-widest text-muted-foreground mb-2">{couch.tvName}</p>
      <h1 className="text-3xl font-bold mb-6" data-testid="join-title">
        Join {couch.host.name}'s couch
      </h1>
      <ul className="flex justify-center flex-wrap gap-4 mb-8" data-testid="join-couch">
        {couch.couch.map((s, i) => {
          const art = stickerArt(LAUNCHER, s.sticker);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: sitters carry no ids (the page gets none) and two can share a name; the list is fixed per load
            <li key={`${s.name}-${i}`} className="flex flex-col items-center gap-1 w-16">
              {art ? (
                <img src={art} alt="" className="w-14 h-14 object-contain" />
              ) : (
                <span className="w-14 h-14 rounded-full bg-muted" />
              )}
              <span className="text-sm font-medium truncate w-full">{s.name}</span>
            </li>
          );
        })}
      </ul>
      {/* No install needed: the browser is enough. The app is the upgrade, never required. */}
      <Button
        size="lg"
        className="w-full mb-3"
        data-testid="join-browser"
        onClick={() => setJoining(true)}
      >
        Join from this browser
      </Button>
      <Button asChild size="lg" variant="outline" className="w-full mb-3">
        <a href={appJoinLink(couch.code)} data-testid="join-open-app">
          Have the OGS app? Open it instead
        </a>
      </Button>
      <GetApp host={couch.host.name} />
    </>
  );
}

function GetApp({ host }: { host: string }) {
  return GET_APP ? (
    <p className="text-sm text-muted-foreground" data-testid="join-get-app">
      Want the app?{" "}
      <a className="underline font-medium" href={GET_APP}>
        Get OGS
      </a>{" "}
      (it remembers you across games).
    </p>
  ) : (
    <p className="text-sm text-muted-foreground" data-testid="join-get-app">
      The OGS app is in beta: ask {host} for an invite to keep your profile across games.
    </p>
  );
}

/** No couch yet (opengame.org/join), a code that isn't on, or no answer: type the code. */
function TypeCode({
  lookup,
  typed,
}: {
  lookup: Exclude<JoinLookup, { kind: "couch" }>;
  typed: string;
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState(typed && lookup.kind === "bad" ? typed : "");
  const said =
    lookup.kind === "gone"
      ? "That couch isn't on any more. Check the code on the TV."
      : lookup.kind === "offline"
        ? "Couldn't reach OGS. Check your connection and try again."
        : typed
          ? "That isn't a TV code. It's the 6 letters and numbers on the TV."
          : "Type the 6 letters and numbers on the TV.";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next = normaliseTvCode(value);
        if (next) navigate(`/join/${next}`);
      }}
    >
      <h1 className="text-3xl font-bold mb-3">Join the couch</h1>
      <p className="text-muted-foreground mb-6" data-testid="join-said">
        {said}
      </p>
      <input
        data-testid="join-code-input"
        aria-label="TV code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={8}
        placeholder="TV code"
        className="w-full text-center text-2xl tracking-[0.3em] font-bold uppercase rounded-lg border bg-background px-4 py-3 mb-3"
      />
      <Button type="submit" size="lg" className="w-full" data-testid="join-code-go">
        Join
      </Button>
    </form>
  );
}

export default Join;
