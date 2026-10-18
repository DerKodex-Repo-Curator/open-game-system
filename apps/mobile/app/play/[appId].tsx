import { readGameLink } from "@open-game-system/ogs-protocol";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Button } from "../../components/ogs/Button";
import { Screen } from "../../components/ogs/Screen";
import { colors } from "../../components/ogs/theme";
import type { JoinOutcome } from "../../services/rooms";
import { appState, inviteAttribution, linkHold, roomJoiner, useApp } from "../../services/runtime";

/**
 * An invite link opened in OGS (spec §7): opengame.org/play/<appId>?room=<room> or
 * opengame://play/…. Starts the game in that room on this couch's TV, or asks to cast first and
 * starts once the TV is cast. Without a room it is a game link: the game's page.
 */
export default function PlayLinkScreen() {
  const router = useRouter();
  const { appId, room, inv } = useLocalSearchParams<{
    appId: string;
    room?: string;
    inv?: string;
  }>();
  const app = useApp();
  const game = [...app.library, ...app.catalogue].find((g) => g.appId === appId);
  const ready = app.identity !== null && game !== undefined;
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);

  // A first-time phone (no profile yet) holds the link through onboarding; a link with no room
  // opens the game's page, where Play is the one button (2026-10-07-game-links.feature).
  useEffect(() => {
    if (!appId) return;
    let live = true;
    void appState.init().then(() => {
      if (!live) return;
      const query = room
        ? `?room=${encodeURIComponent(room)}`
        : inv
          ? `?inv=${encodeURIComponent(inv)}`
          : "";
      const link = `opengame://play/${appId}${query}`;
      if (linkHold.offer(link, "link", appState.getSnapshot().identity !== null))
        router.replace("/");
      else if (!room) {
        // A game link from another family's invite: their first cast counts toward it.
        const invite = readGameLink(link)?.inv;
        if (invite) void inviteAttribution.remember(invite);
        router.replace(`/library/${appId}`);
      }
    });
    return () => {
      live = false;
    };
  }, [appId, room, inv, router]);

  useEffect(() => {
    if (!ready || !appId || !room || outcome !== null) return;
    setOutcome(roomJoiner.join(appId, room));
  }, [ready, appId, room, outcome]);

  const name = game?.name ?? "this game";
  const text = !room
    ? `Opening ${name}…`
    : app.identity === null
      ? "Make your OGS profile first."
      : outcome === "cast-first"
        ? `Cast to your TV, and ${name} starts there in room ${room}.`
        : outcome === "started"
          ? `You're in ${name}, room ${room}.`
          : outcome === "single-couch" || outcome === "unknown-game"
            ? `${name} can't be joined from another couch.`
            : `Opening ${name}…`;

  return (
    <Screen title={name} testID="playLinkScreen">
      <Text style={styles.text} testID="playLinkText">
        {text}
      </Text>
      {outcome === "cast-first" ? (
        <Button label="Cast to TV" testID="playLinkCast" onPress={() => router.navigate("/tv")} />
      ) : (
        <Button
          label="Done"
          kind="ghost"
          testID="playLinkDone"
          onPress={() => router.replace("/playing")}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.cream, fontSize: 19, lineHeight: 26, marginBottom: 18 },
});
