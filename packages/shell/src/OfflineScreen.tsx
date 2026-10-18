import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** The offline screen's colors; a game sets any of them in its shell config (`theme`). */
export interface OfflineTheme {
  background: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
}

export const DEFAULT_OFFLINE_THEME: OfflineTheme = {
  background: "#0B0B12",
  text: "#E8E8ED",
  muted: "#8888A0",
  accent: "#A855F6",
  accentText: "#FFFFFF",
};

export interface OfflineScreenProps {
  gameName: string;
  onRetry: () => void;
  theme?: Partial<OfflineTheme>;
}

/**
 * The shell's native screen for a game page that can't load (App Review: no blank WebView). Keeps
 * the OGS app's testIDs (gameErrorScreen, gameRetryButton) so device tests read the same.
 */
export const OfflineScreen = memo(function OfflineScreen({
  gameName,
  onRetry,
  theme,
}: OfflineScreenProps) {
  const t: OfflineTheme = { ...DEFAULT_OFFLINE_THEME, ...theme };
  return (
    <View style={[styles.container, { backgroundColor: t.background }]} testID="gameErrorScreen">
      <Text style={[styles.title, { color: t.text }]} testID="gameErrorTitle">
        {`Can't reach ${gameName}`}
      </Text>
      <Text style={[styles.message, { color: t.muted }]}>Check your connection and try again.</Text>
      <Pressable
        testID="gameRetryButton"
        accessibilityRole="button"
        style={[styles.retryButton, { backgroundColor: t.accent }]}
        onPress={onRetry}
      >
        <Text style={[styles.retryText, { color: t.accentText }]}>Try again</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3, textAlign: "center" },
  message: { fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 16 },
  retryButton: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, minHeight: 48 },
  retryText: { fontSize: 16, fontWeight: "600" },
});
