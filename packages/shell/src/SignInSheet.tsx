import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeProvider, SignInState } from "./native-sign-in";

export interface SignInSheetProps {
  visible: boolean;
  gameName: string;
  /** The providers this device offers (from each provider's isAvailable()). */
  providers: readonly NativeProvider[];
  state: SignInState;
  onSignIn: (provider: NativeProvider) => void;
  onClose: () => void;
}

const LABELS: Record<NativeProvider, string> = {
  apple: "Sign in with Apple",
  google: "Sign in with Google",
};
const IDS: Record<NativeProvider, string> = { apple: "signInApple", google: "signInGoogle" };

/**
 * The shell's native sign-in sheet, shown when the game asks. The game itself has no sign-in UI;
 * it hears the new profile through the bridge.
 */
export function SignInSheet({
  visible,
  gameName,
  providers,
  state,
  onSignIn,
  onClose,
}: SignInSheetProps) {
  const busy = state.status === "signing-in";
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="signInSheet">
          <Text style={styles.title}>Save your progress</Text>
          <Text style={styles.body}>
            {`Sign in to keep your ${gameName} player on all your devices.`}
          </Text>
          {providers.map((p) => (
            <Pressable
              key={p}
              testID={IDS[p]}
              accessibilityRole="button"
              disabled={busy}
              style={[
                styles.button,
                p === "apple" ? styles.apple : styles.google,
                busy && styles.dim,
              ]}
              onPress={() => {
                if (!busy) onSignIn(p);
              }}
            >
              <Text style={p === "apple" ? styles.appleText : styles.googleText}>{LABELS[p]}</Text>
            </Pressable>
          ))}
          {busy ? <ActivityIndicator testID="signInProgress" style={styles.progress} /> : null}
          {state.status === "error" ? (
            <Text testID="signInError" style={styles.error}>
              Couldn't sign in. Try again.
            </Text>
          ) : null}
          <Pressable
            testID="signInNotNow"
            accessibilityRole="button"
            style={styles.notNow}
            onPress={onClose}
          >
            <Text style={styles.notNowText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#111111" },
  body: { fontSize: 15, lineHeight: 21, color: "#444444", marginBottom: 8 },
  button: {
    minHeight: 50,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  apple: { backgroundColor: "#000000" },
  google: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DADCE0" },
  dim: { opacity: 0.5 },
  appleText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  googleText: { color: "#1F1F1F", fontSize: 17, fontWeight: "600" },
  progress: { marginTop: 4 },
  error: { color: "#B42318", fontSize: 14, textAlign: "center" },
  notNow: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  notNowText: { color: "#555555", fontSize: 16, fontWeight: "500" },
});
