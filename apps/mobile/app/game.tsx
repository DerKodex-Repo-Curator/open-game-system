import {
  BridgedWebView,
  createNativeBridge,
  createNativeBridgeContext,
  type NativeBridge,
} from "@open-game-system/app-bridge-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GameErrorScreen } from "../components/GameErrorScreen";
import { GameArt } from "../components/ogs/GameArt";
import { colors, fonts } from "../components/ogs/theme";
import { SwipeHintOverlay, useSwipeHint } from "../components/SwipeHintOverlay";
import type { CastStores } from "../services/cast-store";
import { parksOnLeave } from "../services/couch-follow";
import { exitGame } from "../services/game-exit";
import { loadingCaption } from "../services/game-loading";
import type { NotificationsStores } from "../services/game-notifications";
import type { ProfileStores } from "../services/game-profile";
import { latestGameUrl, reportSittingFor, sittingId } from "../services/game-rejoin";
import { consumePendingGameUrl, subscribeToGameUrl } from "../services/game-url-store";
import { subscribeHardwareBack } from "../services/hardware-back";
import { createOgsBridgeStore, type OgsStores } from "../services/ogs-bridge";
import {
  appState,
  couchHub,
  deviceId,
  gameCastStoreFor,
  gameNotifications,
  gamePresence,
  gameProfile,
  ogsCastNow,
  pushApi,
  rememberGameUrl,
  useApp,
} from "../services/runtime";
import { swipeBackHandlers } from "../services/swipe-back";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;
const EDGE_WIDTH = 30;

type Stores = CastStores & OgsStores & ProfileStores & NotificationsStores;

// One bridge for the app's lifetime. The game sees the app-level cast through a store that routes
// its TV page to the couch session while cast through OGS (game.view, never a recast), and reports
// its instance through the `ogs` store.
let currentAppId: string | null = null;
const bridge: NativeBridge<Stores> = createNativeBridge<Stores>();
bridge.setStore(
  "cast",
  gameCastStoreFor(() => currentAppId),
);
// While cast, the game's report labels the couch's live sitting (one start is one sitting).
const ogsStore = createOgsBridgeStore(
  (report, source) => appState.report(report, source),
  (appId) => reportSittingFor(appId, couchHub.getSnapshot().state),
);
bridge.setStore("ogs", ogsStore);
// Who is playing: a token for the open game only (never the app's own token).
bridge.setStore("profile", gameProfile.store);
// Pushes (spec §9): the page asks for consent and hears pushes that arrive while it is in front.
bridge.setStore("notifications", gameNotifications.store);
const BridgeContext = createNativeBridgeContext<Stores>();
const CastContext = BridgeContext.createNativeStoreContext("cast");

/** A game, full screen over the tabs. Swiping from the left edge returns (and pauses it on the TV). */
export default function GameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    url?: string;
    name?: string;
    appId?: string;
    instanceId?: string;
  }>();
  const app = useApp();
  const translateX = useRef(new Animated.Value(0)).current;
  const [showSwipeHint, dismissSwipeHint] = useSwipeHint();

  const initialUri = useMemo(
    () => params.url ?? consumePendingGameUrl() ?? "about:blank",
    [params.url],
  );
  const [uri, setUri] = useState(initialUri);
  const prevInitial = useRef(initialUri);
  if (initialUri !== prevInitial.current) {
    prevInitial.current = initialUri;
    setUri(initialUri);
  }

  // Where the game is now: start pages redirect into a room (Rocket Crew `/join/PQWS?t=…`), and
  // Rejoin must return there, not to `uri` (which would open a new room).
  const latestUrl = useRef(uri);
  const latestFor = useRef(uri);
  if (latestFor.current !== uri) {
    latestFor.current = uri;
    latestUrl.current = uri;
  }

  const games = [...app.library, ...app.catalogue];
  const game =
    games.find((g) => g.appId === params.appId) ?? games.find((g) => uri.startsWith(g.startUrl));
  const appId = game?.appId ?? params.appId ?? null;
  const name = game?.name ?? params.name ?? "Game";
  currentAppId = appId;

  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const caption = loadingCaption(game ?? null, uri);
  const originDomain = useMemo(() => {
    try {
      return new URL(uri).hostname;
    } catch {
      return uri;
    }
  }, [uri]);

  // A new game screen: nothing reported yet.
  useEffect(() => {
    ogsStore.reset();
    gameNotifications.store.reset();
  }, []);

  // The open game gets its own token (refreshed before it expires); leaving drops it.
  useEffect(() => {
    gameProfile.open(appId);
    return () => gameProfile.close();
  }, [appId]);

  // While this screen is up the phone has the game open (a host follow for it opens nothing).
  useEffect(() => {
    if (!appId) return;
    gamePresence.opening(appId);
    // Pushes for this game now prefer this phone's app over the game's PWA (no profile yet: skip).
    pushApi.active(appId).catch(() => {});
    return () => gamePresence.closed(appId);
  }, [appId]);

  // Deep links and push taps while a game is open replace it (event subscription).
  useEffect(() => subscribeToGameUrl((url) => setUri(url)), []);

  /** Back to the tabs. `closedByTv`: the TV went Home (every couch phone follows it), so no home. */
  const leave = useCallback(
    (closedByTv = false) => {
      const url = latestUrl.current;
      const session = couchHub.getSnapshot().state;
      if (appId) rememberGameUrl(appId, url);
      exitGame({
        appId,
        name,
        url,
        instanceId: appId ? sittingId(appId, session, params.instanceId) : null,
        // A phone following someone else's game steps out to the remote; the TV keeps playing.
        parks: !closedByTv && (!appId || parksOnLeave(appId, session?.current ?? null, deviceId())),
        ogsCast: ogsCastNow(),
        reported: appId !== null && ogsStore.getSnapshot().reported.includes(appId),
        now: Date.now(),
        send: couchHub.send,
        report: (r, s) => appState.report(r, s),
        setPill: (p) => appState.setPill(p),
        goBack: () => (router.canGoBack() ? router.back() : router.replace("/library")),
      });
    },
    [appId, name, router, params.instanceId],
  );
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  // The TV went Home (or swapped this game away): every couch phone follows it back to the remote.
  useEffect(() => {
    if (!appId) return;
    return gamePresence.onClose(appId, () => leaveRef.current(true));
  }, [appId]);

  // Android's back button leaves like the swipe does (home on the TV), not a bare pop.
  useEffect(() => subscribeHardwareBack(BackHandler, () => leaveRef.current()), []);

  // --- Swipe-back gesture (a cancelled swipe never calls onBack) ---
  const swipe = swipeBackHandlers({
    edge: EDGE_WIDTH,
    threshold: SWIPE_THRESHOLD,
    width: SCREEN_WIDTH,
    follow: (dx) => translateX.setValue(dx),
    settle: (toValue, done) => {
      const anim =
        toValue === 0
          ? Animated.spring(translateX, { toValue, useNativeDriver: true })
          : Animated.timing(translateX, { toValue, duration: 200, useNativeDriver: true });
      anim.start(() => done?.());
    },
    onBack: () => leaveRef.current(),
  });
  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => swipeRef.current.startsAt(evt.nativeEvent.pageX),
      // Capture edge touches too, or the swipe hint (a Pressable that says "Swipe to go home")
      // takes the touch and the swipe it teaches does nothing.
      onStartShouldSetPanResponderCapture: (evt) =>
        swipeRef.current.startsAt(evt.nativeEvent.pageX),
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.pageX < EDGE_WIDTH + 20 && gs.dx > 5,
      onPanResponderMove: (_, gs) => swipeRef.current.move(gs.dx),
      onPanResponderRelease: (_, gs) => swipeRef.current.release(gs.dx),
      onPanResponderTerminate: () => swipeRef.current.terminate(),
    }),
  ).current;

  if (hasError) {
    return (
      <View style={styles.container} testID="gameScreen">
        <StatusBar style="light" />
        <GameErrorScreen
          originDomain={originDomain}
          onRetry={() => {
            setIsLoading(true);
            setHasError(false);
            setUri((u) => `${u}`);
          }}
          onGoHome={() => leave()}
        />
      </View>
    );
  }

  return (
    <BridgeContext.BridgeProvider bridge={bridge}>
      <View style={styles.container} testID="gameScreen">
        <StatusBar style="light" />
        <Animated.View
          style={[styles.fullScreen, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
        >
          <CastContext.StoreProvider>
            <View style={styles.webviewContainer} testID="gameWebView">
              <BridgedWebView
                bridge={bridge}
                source={{ uri }}
                style={styles.webview}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                startInLoadingState={false}
                scalesPageToFit={true}
                webviewDebuggingEnabled={true}
                allowsInlineMediaPlayback={true}
                mediaPlaybackRequiresUserAction={false}
                onNavigationStateChange={(nav) => {
                  latestUrl.current = latestGameUrl(latestUrl.current, nav.url);
                }}
                onLoadEnd={() => {
                  setIsLoading(false);
                  setHasError(false);
                }}
                onError={() => {
                  setIsLoading(false);
                  setHasError(true);
                }}
              />
            </View>
          </CastContext.StoreProvider>

          {!isLoading && showSwipeHint && (
            <SwipeHintOverlay visible={showSwipeHint} onDismiss={dismissSwipeHint} />
          )}

          {isLoading && (
            <View style={styles.loading} testID="gameLoading">
              {game ? <GameArt game={game} style={styles.loadingArt} /> : null}
              <Text style={styles.loadingName}>{name}</Text>
              {caption ? <Text style={styles.loadingOrigin}>{caption}</Text> : null}
            </View>
          )}
        </Animated.View>
      </View>
    </BridgeContext.BridgeProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dusk0 },
  fullScreen: { flex: 1 },
  webviewContainer: { flex: 1 },
  webview: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.dusk0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 32,
  },
  loadingArt: { width: "80%", aspectRatio: 16 / 10 },
  loadingName: { fontFamily: fonts.display, fontSize: 30, color: colors.cream, marginTop: 8 },
  loadingOrigin: { color: colors.cream3, fontSize: 14, textAlign: "center", marginHorizontal: 32 },
});
