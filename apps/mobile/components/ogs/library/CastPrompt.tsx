import { SymbolView } from "expo-symbols";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CastDevice } from "../../../services/cast-store";
import {
  castBackend,
  castNow,
  castPrompt,
  lastTv,
  waitForOgsCast,
} from "../../../services/runtime";
import { userMessage } from "../../../services/user-message";
import { Button } from "../Button";
import { BrowserTv } from "../remote/BrowserTv";
import { lastStop } from "../remote/last-stop";
import { noTvCauses } from "../remote/no-tv";
import { colors, fonts, TARGET } from "../theme";
import { type CastPromptRequest, castPromptView, confirmCast } from "./play-action";

/** How long the prompt looks for TVs before it says none was found (as the TV tab does). */
const SEARCH_MS = 4000;

const useDevices = () =>
  useSyncExternalStore(
    castBackend.subscribeDevices,
    castBackend.getDevices,
    castBackend.getDevices,
  );

/**
 * The cast prompt, mounted once over the tabs: a Play that needs the TV while this phone isn't
 * casting opens it (play-action). Pick a TV, Cast casts the launcher there and the game starts by
 * itself once the TV is up; Not now closes it. A game that also plays here offers this phone.
 * Owner copy rule (2026-10-04): a button says Play or Cast, never both.
 */
export function CastPromptHost() {
  const request = useSyncExternalStore(castPrompt.subscribe, castPrompt.get, castPrompt.get);
  return request ? <CastPromptSheet request={request} /> : null;
}

function CastPromptSheet({ request }: { request: CastPromptRequest }) {
  const insets = useSafeAreaInsets();
  const devices = useDevices();
  const stopped = useSyncExternalStore(lastStop.subscribe, lastStop.get, lastStop.get);
  const [searching, setSearching] = useState(true);
  const [picked, setPicked] = useState<CastDevice | null>(null);
  const [connecting, setConnecting] = useState<CastDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useSyncExternalStore(lastTv.subscribe, lastTv.get, lastTv.get);
  const view = castPromptView({ devices, searching, picked, stopped, last });

  // The search runs for a few seconds each time it starts (a timer: legitimate effect).
  useEffect(() => {
    if (!searching) return;
    castBackend.startDiscovery();
    const t = setTimeout(() => setSearching(false), SEARCH_MS);
    return () => clearTimeout(t);
  }, [searching]);

  const play = (how: "phone" | "played") => {
    castPrompt.dismiss(how);
    request.play();
  };
  const confirm = async () => {
    if (view.kind !== "choose") return;
    const tv = view.target;
    setConnecting(tv);
    setError(null);
    try {
      setError(
        await castPrompt.confirm(() =>
          confirmCast(tv, {
            promptId: castPrompt.promptId() ?? "",
            castNow,
            waitForCast: waitForOgsCast,
            play: () => play("played"),
            log: castPrompt.log,
            errorText: (err) => userMessage(err, "cast").text,
          }),
        ),
      );
    } finally {
      setConnecting(null);
    }
  };
  const busy = connecting !== null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={castPrompt.dismiss}>
      <Pressable
        style={styles.scrim}
        accessibilityLabel="Not now"
        disabled={busy}
        onPress={castPrompt.dismiss}
      />
      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
        testID="castPrompt"
      >
        <View style={styles.grab} />
        <Text style={styles.title} accessibilityRole="header" testID="castPromptTitle">
          Play {request.game.name} on the TV
        </Text>
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          bounces={false}
          testID="castPromptScroll"
        >
          {view.kind === "choose" ? (
            <>
              <Text style={styles.lead}>
                {view.devices.length > 1
                  ? `Pick a TV. ${request.game.name} starts as soon as it's cast.`
                  : `${request.game.name} starts as soon as the TV is cast.`}
              </Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Which TV"
                style={styles.list}
              >
                {view.devices.map((d) => (
                  <TvRow
                    key={d.id}
                    tv={d}
                    on={d.id === view.target.id}
                    connecting={connecting?.id === d.id}
                    disabled={busy}
                    onPick={() => setPicked(d)}
                  />
                ))}
              </View>
            </>
          ) : view.kind === "looking" ? (
            <View style={[styles.row, styles.looking]} testID="castPromptLooking">
              <View style={styles.icon}>
                <ActivityIndicator color={colors.cream2} />
              </View>
              <Text style={styles.lookingText}>Looking for TVs…</Text>
            </View>
          ) : (
            <View testID="castPromptNoTv" style={styles.noTv}>
              <Text style={styles.noTvTitle}>No TV found</Text>
              {/* Most households have no Chromecast: the way that works for them comes first. */}
              <Text style={styles.lead}>No Chromecast? Any TV with a browser works.</Text>
              <BrowserTv onPaired={setPicked} />
              <Text style={styles.lead}>Have a Chromecast? Usually it's one of these:</Text>
              {noTvCauses(Platform.OS).map(([title, body]) => (
                <View key={title} style={styles.cause}>
                  <Text style={styles.causeTitle}>{title}</Text>
                  <Text style={styles.causeBody}>{body}</Text>
                </View>
              ))}
              <View style={styles.noTvActions}>
                <Button
                  label="Try again"
                  testID="castPromptRetry"
                  onPress={() => setSearching(true)}
                  style={styles.flex}
                />
                <Button
                  label="Open Settings"
                  kind="ghost"
                  onPress={() => void Linking.openSettings()}
                  style={styles.flex}
                />
              </View>
            </View>
          )}
          {error ? (
            <Text style={styles.error} testID="castPromptError">
              {error}
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.actions}>
          {view.kind === "choose" ? (
            <Pressable
              testID="castPromptConfirm"
              accessibilityRole="button"
              accessibilityLabel={
                busy ? `Connecting to ${view.target.name}` : `Cast to ${view.target.name}`
              }
              disabled={busy}
              onPress={() => void confirm()}
              style={({ pressed }) => [styles.confirm, (pressed || busy) && styles.pressed]}
            >
              {busy ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <SymbolView
                  name="tv"
                  size={20}
                  weight="semibold"
                  tintColor={colors.ink}
                  style={styles.castSym}
                />
              )}
              <Text style={styles.confirmText} numberOfLines={1}>
                {busy ? `Connecting to ${view.target.name}…` : "Cast"}
              </Text>
            </Pressable>
          ) : null}
          {request.phone ? (
            <Button
              label="Play on this phone"
              kind="ghost"
              testID="castPromptPhone"
              disabled={busy}
              onPress={() => play("phone")}
            />
          ) : null}
          <Pressable
            testID="castPromptDismiss"
            accessibilityRole="button"
            disabled={busy}
            onPress={castPrompt.dismiss}
            style={({ pressed }) => [styles.notNow, pressed && styles.pressed]}
          >
            <Text style={[styles.notNowText, busy && styles.dim]}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function TvRow({
  tv,
  on,
  connecting,
  disabled,
  onPick,
}: {
  tv: CastDevice;
  on: boolean;
  connecting: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <Pressable
      testID={`castPromptTV-${tv.id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={tv.name}
      disabled={disabled}
      onPress={onPick}
      style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.rowPressed]}
    >
      <View style={styles.icon}>
        <SymbolView
          name="tv"
          size={22}
          weight="semibold"
          tintColor={colors.cream}
          style={styles.sym}
        />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {tv.name}
        </Text>
        {connecting ? <Text style={styles.status}>Connecting…</Text> : null}
      </View>
      {connecting ? (
        <ActivityIndicator color={colors.cream} />
      ) : on ? (
        <SymbolView
          name="checkmark.circle.fill"
          size={24}
          tintColor={colors.peach}
          style={styles.check}
        />
      ) : null}
    </Pressable>
  );
}

const BAR = TARGET + 12;

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(10, 8, 20, 0.6)" },
  sheet: {
    maxHeight: "86%",
    backgroundColor: colors.dusk1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
    borderTopWidth: 1,
    borderColor: colors.hair,
  },
  grab: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.hair,
    marginBottom: 4,
  },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.cream },
  body: { flexGrow: 0 },
  bodyContent: { gap: 10 },
  lead: { color: colors.cream2, fontSize: 16, lineHeight: 22 },
  list: { gap: 10 },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.dusk2,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  rowOn: { borderColor: colors.peach },
  rowPressed: { backgroundColor: colors.dusk3 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.dusk3,
    alignItems: "center",
    justifyContent: "center",
  },
  sym: { width: 22, height: 22 },
  rowText: { flex: 1, gap: 2 },
  name: { color: colors.cream, fontSize: 17, fontWeight: "700" },
  status: { color: colors.cream2, fontSize: 15 },
  check: { width: 24, height: 24 },
  looking: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.hair,
    borderStyle: "dashed",
  },
  lookingText: { color: colors.cream2, fontSize: 16, fontWeight: "600" },
  noTv: { gap: 8 },
  noTvTitle: { color: colors.cream, fontSize: 19, fontWeight: "700" },
  cause: { backgroundColor: colors.dusk2, borderRadius: 16, padding: 12 },
  causeTitle: { color: colors.cream, fontSize: 16, fontWeight: "700" },
  causeBody: { color: colors.cream3, fontSize: 14, marginTop: 3, lineHeight: 20 },
  noTvActions: { flexDirection: "row", gap: 12, marginTop: 6 },
  flex: { flex: 1 },
  error: { color: colors.peach, fontSize: 15 },
  actions: { gap: 10, paddingTop: 4 },
  confirm: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: BAR,
    paddingHorizontal: 20,
    borderRadius: BAR / 2,
    backgroundColor: colors.lamp,
  },
  pressed: { opacity: 0.8 },
  castSym: { width: 22, height: 20 },
  confirmText: { color: colors.ink, fontSize: 19, fontWeight: "800" },
  notNow: { minHeight: TARGET, alignItems: "center", justifyContent: "center" },
  notNowText: { color: colors.cream2, fontSize: 17, fontWeight: "700" },
  dim: { opacity: 0.5 },
});
