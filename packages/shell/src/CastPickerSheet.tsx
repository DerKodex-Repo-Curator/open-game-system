import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CastPickerState } from "./cast-picker";

export interface CastPickerSheetProps {
  state: CastPickerState;
  onPick: (deviceId: string) => void;
  onOpenBrowserTv: () => void;
  onPair: (code: string) => void;
  onClose: () => void;
}

/** The OGS TV code is 6 characters (ogs-protocol TvCodeSchema). */
const CODE_LENGTH = 6;

/**
 * The shell's native TV picker, opened by the game's cast button: the Chromecasts found (and the
 * browser TVs this phone paired), and "Use a browser TV": open the OGS TV page on the TV (or a
 * laptop plugged into it), then type the code it shows. testIDs match the OGS app's browser-TV UI.
 */
export function CastPickerSheet({
  state,
  onPick,
  onOpenBrowserTv,
  onPair,
  onClose,
}: CastPickerSheetProps) {
  const [code, setCode] = useState("");
  const tv = state.browserTv;
  const busy = tv?.pairing === true;
  const canPair = !busy && code.trim().length >= CODE_LENGTH;
  const pair = () => {
    if (canPair) onPair(code);
  };
  return (
    <Modal visible={state.visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="castPicker" accessibilityLabel="Play on TV">
          <Text style={styles.title}>Play on TV</Text>
          {state.devices.length === 0 ? (
            <Text style={styles.body} testID="castPickerNoDevices">
              No Chromecast found on this Wi-Fi.
            </Text>
          ) : (
            state.devices.map((d) => (
              <Pressable
                key={d.id}
                testID={`castPickerDevice-${d.id}`}
                accessibilityRole="button"
                accessibilityLabel={d.name}
                style={styles.device}
                onPress={() => onPick(d.id)}
              >
                <Text style={styles.deviceName}>{d.name}</Text>
              </Pressable>
            ))
          )}
          {tv && !tv.open ? (
            <Pressable
              testID="browserTvOpen"
              accessibilityRole="button"
              accessibilityLabel="Use a browser TV"
              style={styles.secondary}
              onPress={onOpenBrowserTv}
            >
              <Text style={styles.secondaryText}>Use a browser TV</Text>
            </Pressable>
          ) : null}
          {tv?.open ? (
            <View style={styles.browserTv} testID="browserTv">
              <Text style={styles.subtitle}>Use a browser TV</Text>
              <Text style={styles.body}>
                On the TV (or a laptop plugged into it), open{" "}
                <Text style={styles.address} testID="browserTvAddress">
                  {tv.address}
                </Text>{" "}
                in the browser, then type the code it shows.
              </Text>
              <View style={styles.row}>
                <TextInput
                  testID="browserTvCode"
                  accessibilityLabel="Code on the TV"
                  value={code}
                  onChangeText={(t) => setCode(t.toUpperCase())}
                  style={styles.input}
                  placeholder="Code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                  returnKeyType="go"
                  onSubmitEditing={pair}
                />
                <Pressable
                  testID="browserTvPair"
                  accessibilityRole="button"
                  accessibilityLabel="Pair"
                  accessibilityState={{ disabled: !canPair }}
                  disabled={!canPair}
                  style={[styles.pair, !canPair && styles.dim]}
                  onPress={pair}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" testID="browserTvPairing" />
                  ) : (
                    <Text style={styles.pairText}>Pair</Text>
                  )}
                </Pressable>
              </View>
              {tv.error ? (
                <Text style={styles.error} testID="browserTvError">
                  {tv.error}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Pressable
            testID="castPickerClose"
            accessibilityRole="button"
            style={styles.close}
            onPress={onClose}
          >
            <Text style={styles.closeText}>Not now</Text>
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
  subtitle: { fontSize: 18, fontWeight: "700", color: "#111111" },
  body: { fontSize: 15, lineHeight: 21, color: "#444444" },
  address: { fontWeight: "700", color: "#111111" },
  device: {
    minHeight: 50,
    borderRadius: 10,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#F2F2F4",
  },
  deviceName: { fontSize: 17, fontWeight: "600", color: "#111111" },
  secondary: {
    minHeight: 50,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#DADCE0",
  },
  secondaryText: { fontSize: 17, fontWeight: "600", color: "#1F1F1F" },
  browserTv: { gap: 10 },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DADCE0",
    paddingHorizontal: 12,
    fontSize: 20,
    letterSpacing: 4,
    color: "#111111",
  },
  pair: {
    minHeight: 50,
    minWidth: 88,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111111",
    paddingHorizontal: 16,
  },
  pairText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  dim: { opacity: 0.5 },
  error: { color: "#B42318", fontSize: 14 },
  close: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: "#555555", fontSize: 16, fontWeight: "500" },
});
