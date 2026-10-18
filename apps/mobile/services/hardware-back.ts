/** The slice of React Native's BackHandler this needs (keeps it testable). */
type BackHandlerLike = {
  addEventListener(
    event: "hardwareBackPress",
    handler: () => boolean | null | undefined,
  ): { remove(): void };
};

/**
 * Android's back button runs `onBack` and reports the press handled, so the screen isn't simply
 * popped: the game screen leaves the OGS way, as the iOS edge swipe does. Returns the unsubscribe.
 */
export function subscribeHardwareBack(
  backHandler: BackHandlerLike,
  onBack: () => void,
): () => void {
  const sub = backHandler.addEventListener("hardwareBackPress", () => {
    onBack();
    return true;
  });
  return () => sub.remove();
}
