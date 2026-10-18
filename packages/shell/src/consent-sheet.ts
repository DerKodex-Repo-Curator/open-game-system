import { Alert } from "react-native";

/** The app's own sheet for a game's push request (spec §9): Allow or Not now. */
export function askToNotify(gameName: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `Let ${gameName} notify you?`,
      "Only when something needs you, like your turn. You can turn it off in Settings.",
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Allow", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
