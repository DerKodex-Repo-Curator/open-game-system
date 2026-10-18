import { type Manifest, readPlayItem, type SessionState } from "@open-game-system/ogs-protocol";
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Boot } from "../boot";
import { buildHome, homeFocusRows, homeMove, homeStart, recoverFocus } from "../launcher/home";
import { nameForDevice, phoneOf, playersOf } from "../launcher/people";
import { pageMove } from "../launcher/shortcuts";
import { waitingForView } from "../launcher/starting";
import { themeFor } from "../launcher/theme";
import type { Connection, SessionClient } from "../session/client";
import { type LauncherData, liveSession } from "../session/data";
import { Assembling } from "./Assembling";
import { GamePage } from "./GamePage";
import { Home } from "./Home";
import { Player } from "./Player";
import { Stage } from "./Stage";
import { Surprise } from "./Surprise";
import { useFrames } from "./useFrames";
import { useNow } from "./useNow";
import { useTheme } from "./useTheme";
import { useViewTimeout } from "./useViewTimeout";

export function App({ boot }: { boot: Boot }) {
  return (
    <Stage>
      <Suspense fallback={<Assembling />}>
        <Launcher boot={boot} />
      </Suspense>
    </Stage>
  );
}

function Launcher({ boot }: { boot: Boot }) {
  const data = use(boot.data);
  const snap = useSyncExternalStore(boot.client.subscribe, boot.client.getSnapshot);
  if (!snap.state) return <Connecting data={data} />;
  return (
    <Living
      client={boot.client}
      state={snap.state}
      connection={snap.connection}
      data={data}
      frameTimeoutMs={boot.frameTimeoutMs}
      viewTimeoutMs={boot.viewTimeoutMs}
      grants={boot.grants}
    />
  );
}

function Connecting({ data }: { data: LauncherData }) {
  const home = useMemo(
    () =>
      buildHome({ games: data.games, instances: data.instances, suspended: [], now: Date.now() }),
    [data],
  );
  return <Assembling session={data.session} home={home} />;
}

const KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function Living(props: {
  client: SessionClient;
  state: SessionState;
  connection: Connection;
  data: LauncherData;
  frameTimeoutMs: number;
  viewTimeoutMs: number;
  grants: Boot["grants"];
}) {
  const { client, data } = props;
  const { state, connection } = props;
  const now = useNow();
  const games = useMemo(() => new Map(data.games.map((g) => [g.appId, g])), [data.games]);
  // Surprise me's pick is rolled once per visit home, so its card keeps one item id while focused.
  const [surpriseSeed, setSurpriseSeed] = useState(Math.random);
  const [lastScreen, setLastScreen] = useState(state.screen);
  if (lastScreen !== state.screen) {
    setLastScreen(state.screen);
    if (state.screen === "home") setSurpriseSeed(Math.random());
  }
  // While a game is up, home behind it keeps the cards it had, so the box it grew from stays put.
  const homeSuspended = useRef(state.suspended);
  if (state.screen !== "game") homeSuspended.current = state.suspended;
  const suspended = homeSuspended.current;
  const home = useMemo(
    () =>
      buildHome({
        games: data.games,
        instances: data.instances,
        suspended,
        now,
        surpriseSeed,
      }),
    [data, suspended, now, surpriseSeed],
  );
  const grid = useMemo(() => homeFocusRows(home), [home]);
  // PS5-style: Home plays the focused game's theme; every other screen is silent.
  useTheme(themeFor({ screen: state.screen, focus: state.focus, home, games: data.games }));
  const pageGame = state.page ? games.get(state.page) : undefined;

  // The launcher owns its layout: a remote press arrives as focus.move, the ring's new place goes back.
  const onMove = useEffectEvent((dir: "up" | "down" | "left" | "right") => {
    const next =
      state.screen === "home"
        ? homeMove(grid, state.focus, dir, lastIcon.current)
        : state.screen === "game-page" && pageGame
          ? pageMove(
              state.focus,
              dir,
              state.suspended.some((g) => g.appId === pageGame.appId),
            )
          : null;
    if (next && next !== state.focus) client.send({ type: "focus.set", itemId: next });
  });
  useEffect(() => client.onFocusMove((d) => onMove(d)), [client]);

  // The last icon the ring was on: up from the cards returns there.
  const lastIcon = useRef<string | null>(null);
  if (grid[0]?.items.includes(state.focus ?? "")) lastIcon.current = state.focus;
  // Back from a game's page the ring returns to that game's icon.
  const lastPage = useRef<string | null>(null);
  if (pageGame) lastPage.current = pageGame.appId;
  const sentInitial = useRef<string | null>(null);
  useEffect(() => {
    if (state.screen !== "home" || connection !== "open") return;
    const next = recoverFocus(grid, state.focus, lastPage.current, homeStart(home));
    if (next && sentInitial.current !== `${state.focus}->${next}`) {
      sentInitial.current = `${state.focus}->${next}`;
      client.send({ type: "focus.set", itemId: next });
    }
  }, [state.screen, state.focus, grid, home, connection, client]);

  // A sitting started from the Surprise card plays the reel over Getting ready, once.
  const homeFocus = useRef<string | null>(null);
  const surpriseFor = useRef<string | null>(null);
  const startedFrom = useRef<string | null>(null);
  if (state.screen === "home") homeFocus.current = state.focus;
  else if (state.screen === "game" && state.current && homeFocus.current) {
    startedFrom.current = homeFocus.current;
    const play = readPlayItem(homeFocus.current);
    const picked = play && !play.instanceId && play.appId === state.current.appId;
    surpriseFor.current = picked ? state.current.instanceId : null;
    homeFocus.current = null;
  }
  const [reelDone, setReelDone] = useState<string | null>(null);
  const surprising =
    state.screen === "game" &&
    state.current !== null &&
    surpriseFor.current === state.current.instanceId &&
    reelDone !== state.current.instanceId;
  const reelInstance = state.current?.instanceId ?? null;
  const endReel = useCallback(() => setReelDone(reelInstance), [reelInstance]);
  const surpriseCard = home.cards.find((c) => c.kind === "surprise");
  const surprisePool = surpriseCard?.kind === "surprise" ? surpriseCard.pool : [];
  const playersFor = useCallback((appId: string) => playersOf(state, appId), [state]);

  // A keyboard drives the session the way the phone's remote does (development; a TV has none).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const dir = KEYS[e.key];
    if (dir) client.send({ type: "focus.move", dir });
    else if (e.key === "Enter")
      client.send({ type: "select", deviceId: state.remote ?? "tv-keys" });
    else if (e.key === "Escape" || e.key === "Backspace") client.send({ type: "back" });
    else if (e.key === "h") client.send({ type: "home" });
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const frames = useFrames(client, state.current, props.frameTimeoutMs, props.grants);
  const viewOverdue = useViewTimeout(
    waitingForView(state.screen, state.current),
    props.viewTimeoutMs,
  );
  const lastGame = useRef<Manifest | null>(null);
  const currentGame = state.current ? (games.get(state.current.appId) ?? null) : null;
  if (currentGame) lastGame.current = currentGame;
  const remoteHolder = nameForDevice(state, state.remote);

  return (
    <div className="launcher" data-screen={state.screen} data-connection={connection}>
      <Home
        home={home}
        focus={state.focus}
        session={liveSession(data.session, state)}
        members={state.members}
        playersOf={playersFor}
        remoteHolder={remoteHolder}
        now={now}
      />
      {state.screen === "game-page" && pageGame && (
        <GamePage game={pageGame} state={state} remoteHolder={remoteHolder} now={now} />
      )}
      <Player
        screen={state.screen}
        game={currentGame ?? lastGame.current}
        hostPhone={phoneOf(state, state.current?.hostDeviceId ?? null)}
        remoteHolder={remoteHolder}
        frames={frames}
        viewOverdue={viewOverdue}
        origin={startedFrom.current}
      />
      {surprising && state.current && (
        <Surprise
          icons={home.icons.filter((i) => surprisePool.includes(i.appId))}
          pick={state.current.appId}
          line={`Starting ${games.get(state.current.appId)?.name ?? "the game"} on ${phoneOf(state, state.current.hostDeviceId)}`}
          onDone={endReel}
        />
      )}
      {connection === "reconnecting" && (
        <div className="connection-chip" data-testid="reconnecting">
          <span className="pulse" />
          Reconnecting to the phones
        </div>
      )}
    </div>
  );
}
