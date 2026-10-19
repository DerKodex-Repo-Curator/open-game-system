import type { RecentPlayer } from "@open-game-system/ogs-protocol";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { inviteRecentRows } from "../../../services/invite-recent";
import { api } from "../../../services/runtime";
import { Button } from "../Button";
import { ErrorLine } from "../ErrorLine";
import { Sticker } from "../Sticker";
import { colors, fonts } from "../theme";

/**
 * While the couch is on: push its join link to the people who shared a couch with this host in
 * the last 7 days (docs/acceptance/2026-10-18-second-visit.feature, "Invite last week's players").
 * Browser guests aren't listed: they rejoin from the TV's QR code in one tap.
 */
export function InviteRecent() {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<RecentPlayer[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = async () => {
    setOpen(true);
    setError(null);
    try {
      setPlayers(await api.recentPlayers());
    } catch {
      setError("Couldn't load last week's players. Check your connection.");
    }
  };
  const invite = async (profileId: string) => {
    setBusy(profileId);
    setError(null);
    try {
      const r = await api.inviteToCouch([profileId]);
      // Skipped here means OGS already invited them to this couch: shown as invited too.
      setSent((s) => new Set([...s, ...r.invited, ...r.skipped]));
    } catch {
      setError("Couldn't send the invite. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const rows = players ? inviteRecentRows(players, sent) : [];

  return (
    <>
      <Pressable onPress={() => void show()} testID="inviteRecentOpen" hitSlop={8}>
        <Text style={styles.open}>Invite last week's players</Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.sheet} testID="inviteRecent">
          <View style={styles.header}>
            <Text style={styles.title}>Last week's players</Text>
            <Button
              label="Done"
              kind="ghost"
              testID="inviteRecentDone"
              onPress={() => setOpen(false)}
            />
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {players && rows.length === 0 ? (
              <Text style={styles.body} testID="inviteRecentEmpty">
                Nobody shared your couch this week. Guests from a browser can scan the TV's code.
              </Text>
            ) : null}
            {rows.map((r) => (
              <View key={r.profileId} style={styles.row} testID={`inviteRecent-${r.profileId}`}>
                <Sticker id={r.sticker} size={40} />
                <Text style={styles.name}>{r.name}</Text>
                {r.state === "invite" ? (
                  <Button
                    label={busy === r.profileId ? "Inviting…" : "Invite"}
                    testID={`inviteRecentSend-${r.profileId}`}
                    disabled={busy !== null}
                    onPress={() => void invite(r.profileId)}
                  />
                ) : (
                  <Text style={styles.state} testID={`inviteRecentState-${r.profileId}`}>
                    {r.state === "invited" ? "Invited" : "Can't be notified"}
                  </Text>
                )}
              </View>
            ))}
            <ErrorLine text={error} testID="inviteRecentError" />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  open: { color: colors.cream2, fontSize: 15, textDecorationLine: "underline", marginTop: 8 },
  sheet: { flex: 1, backgroundColor: colors.dusk1, padding: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.cream },
  list: { gap: 14, paddingTop: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { flex: 1, color: colors.cream, fontSize: 18 },
  body: { color: colors.cream2, fontSize: 16, lineHeight: 22 },
  state: { color: colors.cream2, fontSize: 15 },
});
