import { createStore } from "@open-game-system/app-bridge-native";
import type { State, Store } from "@open-game-system/app-bridge-types";
import { type InstanceReport, OgsBridgeEventSchema } from "@open-game-system/ogs-protocol";
import type { InstanceSource } from "./api-request";

/** What the page sees: which games on this screen have reported themselves. */
export interface OgsBridgeState extends State {
  reported: string[];
}

/** Events arrive as whatever JSON the page sent; they're parsed here (OgsBridgeEventSchema). */
export type UntrustedEvent = { type: string } & Record<string, unknown>;

export type OgsStores = {
  ogs: { state: OgsBridgeState; events: UntrustedEvent };
};

type Internal = { type: "REPORTED"; appId: string };

/**
 * The `ogs` app-bridge store: a game page in the app's WebView calls INSTANCE_REPORT
 * (ogs.instance({ id, status, title, detail })) and the app posts it to OGS with source "bridge".
 * The report labels the sitting the game screen holds (`sittingFor`, e.g. the couch session's live
 * one), so it is filed under that sitting's id; under the game's own id (`story-nook:XJNE`) only
 * when the screen holds none. Otherwise one start is two sittings: the couch's and the game's.
 */
export function createOgsBridgeStore(
  post: (report: InstanceReport, source: InstanceSource) => Promise<unknown>,
  // Stryker disable next-line ArrowFunction: equivalent, undefined ?? instanceId is null ?? instanceId
  sittingFor: (appId: string) => string | null = () => null,
): Store<OgsBridgeState, UntrustedEvent> {
  const inner = createStore<OgsBridgeState, Internal>({
    initialState: { reported: [] },
    producer: (draft, event) => {
      if (!draft.reported.includes(event.appId)) draft.reported.push(event.appId);
    },
  });
  return {
    getSnapshot: () => inner.getSnapshot(),
    subscribe: (listener) => inner.subscribe(listener),
    reset: () => inner.reset(),
    on: () => () => {},
    dispatch(event) {
      const parsed = OgsBridgeEventSchema.safeParse(event);
      if (!parsed.success) return;
      const { report } = parsed.data;
      // Stryker disable next-line StringLiteral: equivalent, the producer reads only appId
      inner.dispatch({ type: "REPORTED", appId: report.appId });
      const instanceId = sittingFor(report.appId) ?? report.instanceId;
      post({ ...report, instanceId }, "bridge").catch((err: unknown) => {
        console.warn("[ogs] could not post the game's instance report:", err);
      });
    },
  };
}
