import { useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { inviteGame } from "../../../services/invite-family";
import { api, useApp } from "../../../services/runtime";
import { Button } from "../Button";
import { ErrorLine } from "../ErrorLine";
import { colors, fonts } from "../theme";

/**
 * The end of a session (Stop casting): invite another family to the game played last
 * (2026-10-18-invite-another-family.feature). Making the invite logs funnel.invite_sent; its link
 * (opengame.org/play/<appId>?inv=<id>) counts the other household's way in.
 */
export function InviteFamily() {
  const app = useApp();
  const game = inviteGame(app.instances, [...app.library, ...app.catalogue]);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!game) return null;

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.createFamilyInvite(game.appId);
      setLink(made.link);
      void Share.share({
        message: `Play ${game.name} on your TV with us! ${made.link}`,
      });
    } catch {
      setError("Couldn't make the invite. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box} testID="inviteFamily">
      <Text style={styles.title}>Had fun?</Text>
      <Text style={styles.body}>Invite another family to play {game.name} on their TV.</Text>
      {link ? (
        <>
          <Text style={styles.link} selectable testID="inviteFamilyLink">
            {link}
          </Text>
          <Button
            label="Share again"
            kind="ghost"
            testID="inviteFamilyShare"
            onPress={() =>
              void Share.share({ message: `Play ${game.name} on your TV with us! ${link}` })
            }
          />
        </>
      ) : (
        <Button
          label={busy ? "Making the invite…" : "Invite another family"}
          testID="inviteFamilyOpen"
          disabled={busy}
          onPress={() => void make()}
        />
      )}
      <ErrorLine text={error} testID="inviteFamilyError" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 24, gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.cream },
  body: { color: colors.cream2, fontSize: 16, lineHeight: 22 },
  link: { color: colors.cream, fontSize: 15 },
});
