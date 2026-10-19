import { z } from "zod";

/** The slice of React Native's Linking (or expo-linking) this needs. */
export interface LinkingLike {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: "url", listener: (event: { url: string }) => void): { remove(): void };
  /**
   * expo-linking's getLinkingURL: the latest link the OS handed the app, kept natively from launch.
   * It covers a link React Native's Linking loses: one handed to an app that is already starting
   * (iOS application:openURL: before the JS listens), which isn't a launch option.
   */
  getLinkingURL?(): string | null;
}

/** The link the app was opened with, if the linking keeps one (synchronous: before the first render). */
export function launchUrl(linking: LinkingLike): string | null {
  try {
    return linking.getLinkingURL?.() ?? null;
  } catch (err) {
    console.warn("[ogs-shell] no kept link:", err);
    return null;
  }
}

/** The slice of expo-notifications this needs: push taps (a cold start's, then each later one). */
export interface PushTapsLike {
  getLastNotificationResponse(): unknown;
  addNotificationResponseReceivedListener(listener: (response: unknown) => void): {
    remove(): void;
  };
}

/** A notification response (expo-notifications), parsed at the boundary. */
const PushTapSchema = z.object({
  notification: z.object({
    request: z.object({
      identifier: z.string().optional(),
      content: z.object({ data: z.object({ url: z.string().min(1) }).nullish() }),
    }),
  }),
});

function parseTap(response: unknown): { id: string | null; url: string } | null {
  const parsed = PushTapSchema.safeParse(response);
  const url = parsed.success ? parsed.data.notification.request.content.data?.url : undefined;
  if (!parsed.success || !url) return null;
  return { id: parsed.data.notification.request.identifier ?? null, url };
}

/** The URL a tapped push carries in its data (`data.url`, as OGS push links send it), or null. */
export function pushTapUrl(response: unknown): string | null {
  return parseTap(response)?.url ?? null;
}

/** The push that launched the app; a native module that can't say (no response yet) is no tap. */
function launchTap(pushTaps: PushTapsLike | undefined): unknown {
  try {
    return pushTaps?.getLastNotificationResponse() ?? null;
  } catch (err) {
    console.warn("[ogs-shell] no launch push:", err);
    return null;
  }
}

/**
 * Every URL that should open in the app, as it arrives: the link the app was launched with, links
 * opened while it runs, and push taps (the one that launched the app, then each later one, once per
 * notification). Returns the stop function.
 */
export function watchIncomingUrls(opts: {
  linking: LinkingLike;
  pushTaps?: PushTapsLike;
  open: (url: string) => void;
}): () => void {
  let live = true;
  const seenTaps = new Set<string>();
  const onTap = (response: unknown) => {
    const tap = parseTap(response);
    if (!tap) return;
    if (tap.id !== null) {
      if (seenTaps.has(tap.id)) return;
      seenTaps.add(tap.id);
    }
    opts.open(tap.url);
  };

  const linkSub = opts.linking.addEventListener("url", ({ url }) => opts.open(url));
  // After subscribing: a link that came before the listener is the kept one (or the launch option).
  const kept = launchUrl(opts.linking);
  (kept ? Promise.resolve(kept) : opts.linking.getInitialURL()).then(
    (url) => {
      if (live && url) opts.open(url);
    },
    () => {},
  );
  const tapSub = opts.pushTaps?.addNotificationResponseReceivedListener(onTap);
  onTap(launchTap(opts.pushTaps));

  return () => {
    live = false;
    linkSub.remove();
    tapSub?.remove();
  };
}
