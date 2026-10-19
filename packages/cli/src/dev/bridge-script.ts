import type { ProfileBridgeState } from "@open-game-system/ogs-protocol";

/** What one fake phone's app bridge holds: the stores the OGS app gives a game's WebView. */
export type PhoneBridge = {
  phone: number;
  stores: {
    profile: ProfileBridgeState;
    ogs: { reported: string[] };
    notifications: { answer: null; last: null };
    cast: {
      isAvailable: boolean;
      devices: { id: string; name: string; type: "chromecast" }[];
      session: {
        status: "connected";
        deviceId: string;
        deviceName: string;
        sessionId: string;
        streamSessionId: null;
      };
      error: null;
      viewUrl: string | null;
    };
  };
  /** A push handle the fake app grants when the game asks for notifications. */
  pushHandle: string;
};

/** JSON safe inside a <script> element. */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/**
 * The fake OGS app, injected first into a phone page's <head>. It speaks app-bridge-web's
 * protocol: `window.ReactNativeWebView` exists (so createWebBridge is "supported"), BRIDGE_READY
 * is answered with a STATE_INIT per store (as the native bridge does), and game events
 * (notifications REQUEST, cast SET_VIEW_URL, ogs INSTANCE_REPORT) are answered here and passed to
 * the harness page (when framed) to log and act on.
 */
export function bridgeScript(bridge: PhoneBridge): string {
  return `<script data-ogs-dev-bridge>(function () {
  var cfg = ${scriptJson(bridge)};
  var stores = cfg.stores;
  function toWeb(storeKey) {
    window.postMessage(JSON.stringify({ type: "STATE_INIT", storeKey: storeKey, data: stores[storeKey] }), "*");
  }
  function toHarness(message) {
    if (window.parent !== window) window.parent.postMessage({ type: "ogs-dev:bridge", phone: cfg.phone, message: message }, "*");
  }
  function onEvent(storeKey, event) {
    if (storeKey === "notifications" && event.type === "REQUEST") {
      stores.notifications = { answer: { id: event.id, result: { status: "granted", handle: event.handle || cfg.pushHandle } }, last: null };
      toWeb("notifications");
    } else if (storeKey === "cast" && event.type === "SET_VIEW_URL") {
      stores.cast = Object.assign({}, stores.cast, { viewUrl: event.url });
      toWeb("cast");
    } else if (storeKey === "ogs" && event.type === "INSTANCE_REPORT") {
      stores.ogs = { reported: stores.ogs.reported.concat([event.report.title || ""]) };
      toWeb("ogs");
    }
  }
  window.__ogsDev = cfg;
  window.ReactNativeWebView = {
    postMessage: function (raw) {
      var message;
      try { message = JSON.parse(raw); } catch (e) { return; }
      toHarness(message);
      if (message.type === "BRIDGE_READY") Object.keys(stores).forEach(toWeb);
      else if (message.type === "EVENT") onEvent(message.storeKey, message.event);
    }
  };
})();</script>`;
}

/** The page with the bridge script first in its <head> (or first of all, with no head). */
export function injectBridge(html: string, script: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return (
      html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length)
    );
  const doc = /<html(\s[^>]*)?>/i.exec(html);
  if (doc)
    return (
      html.slice(0, doc.index + doc[0].length) + script + html.slice(doc.index + doc[0].length)
    );
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + script + html.slice(doctype[0].length);
  return script + html;
}
