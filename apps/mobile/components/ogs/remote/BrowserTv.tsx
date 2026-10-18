import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { CastDevice } from "../../../services/cast-store";
import { browserTvs, config } from "../../../services/runtime";
import { Button } from "../Button";
import { ErrorLine } from "../ErrorLine";
import { colors, fonts, TARGET } from "../theme";

/** Where the TV's browser goes: the launcher's own address (ogs-tv.pages.dev in production). */
const tvAddress = () => {
  try {
    return new URL(config.tvBase).host;
  } catch {
    return config.tvBase;
  }
};

/**
 * No Chromecast? Any TV with a browser (a laptop on HDMI, a smart TV, a console) is an OGS TV
 * (2026-10-17-browser-tv.feature): open the TV page there and type the code it shows. Once paired
 * it is one of this phone's TVs, cast to like any other.
 */
export function BrowserTv({ onPaired }: { onPaired?: (tv: CastDevice) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <Button
        label="Use a browser TV"
        kind="ghost"
        testID="browserTvOpen"
        onPress={() => setOpen(true)}
      />
    );

  const pair = async () => {
    setBusy(true);
    setError(null);
    const result = await browserTvs.addScreen(code);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setCode("");
    setOpen(false);
    onPaired?.(result.device);
  };

  return (
    <View style={styles.box} testID="browserTv">
      <Text style={styles.title}>Use a browser TV</Text>
      <Text style={styles.body}>
        On the TV (or a laptop plugged into it), open{" "}
        <Text style={styles.address} testID="browserTvAddress">
          {tvAddress()}
        </Text>{" "}
        in the browser, then type the code it shows.
      </Text>
      <View style={styles.row}>
        <TextInput
          testID="browserTvCode"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          style={styles.input}
          placeholder="Code"
          placeholderTextColor={colors.cream3}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          accessibilityLabel="Code on the TV"
          returnKeyType="go"
          onSubmitEditing={() => {
            if (!busy && code.trim().length >= 6) void pair();
          }}
        />
        <Button
          label={busy ? "Pairing…" : "Pair"}
          testID="browserTvPair"
          disabled={busy || code.trim().length < 6}
          onPress={() => void pair()}
        />
      </View>
      <ErrorLine text={error} testID="browserTvError" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 20, gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.cream },
  body: { color: colors.cream2, fontSize: 16, lineHeight: 22 },
  address: { color: colors.cream, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: TARGET + 4,
    borderRadius: 12,
    backgroundColor: colors.dusk1,
    borderWidth: 1,
    borderColor: colors.hair,
    color: colors.cream,
    paddingHorizontal: 12,
    fontSize: 20,
    letterSpacing: 4,
  },
});
