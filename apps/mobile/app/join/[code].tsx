import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Button } from "../../components/ogs/Button";
import { Screen } from "../../components/ogs/Screen";
import { colors } from "../../components/ogs/theme";
import { appState, linkHold } from "../../services/runtime";

/**
 * The TV's join QR opened in OGS (spec ogs-join): opengame.org/join/<code> or opengame://join/<code>.
 * Joins that couch with the code and goes to the remote; a code that isn't on says so. Expo Router
 * opens this screen straight from the link, even on a phone with no profile yet (a stranger's first
 * scan): then the link waits while onboarding makes one, and the index route brings it back here.
 */
export default function JoinLinkScreen() {
  const router = useRouter();
  const { code = "" } = useLocalSearchParams<{ code: string }>();
  const [failed, setFailed] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || !code) return;
    asked.current = true;
    void (async () => {
      await appState.init();
      const hasProfile = appState.getSnapshot().identity !== null;
      if (linkHold.offer(`opengame://join/${code}`, "link", hasProfile)) {
        router.replace("/");
        return;
      }
      const r = await appState.joinSession(code);
      if (r.ok) router.replace("/tv");
      else setFailed(r.message);
    })();
  }, [code, router]);

  return (
    <Screen title="Join the couch" testID="joinLinkScreen">
      <Text style={styles.text} testID="joinLinkText">
        {failed ?? `Joining the couch on TV ${code}…`}
      </Text>
      {failed ? (
        <Button
          label="Type the code"
          testID="joinLinkTypeCode"
          onPress={() => router.replace("/tv")}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.cream, fontSize: 19, lineHeight: 26, marginBottom: 18 },
});
