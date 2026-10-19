import { Text, View } from "react-native";

// TODO: render <OgsShell /> from "@open-game-system/shell" once it lands (branch claude/shell-runtime).
export default function Game() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Example Game</Text>
    </View>
  );
}
