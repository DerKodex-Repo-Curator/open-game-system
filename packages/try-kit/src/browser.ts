/**
 * try-kit in the browser: the network banner, the QR code of a join link, and the window that lets a
 * visitor play a seat on the TV's own computer. Plain DOM, no framework.
 */
import qrcode from "qrcode-generator";
import { probeWebSocket, type SocketLike } from "./probe";

export { isControllerDevice, NARROW_QUERY, offerThisComputer } from "./device";

const DEFAULT_TEXT =
  "Can't reach the game. This network seems to block WebSockets, which the game needs (some office and school networks do). Try another network, or your phone's mobile data.";

/**
 * Probes the Worker's `/ws-probe` once; if this network blocks WebSockets, shows an alert at the top
 * of the page (class `try-network-banner`, inline-styled so it shows on any page). Resolves when the
 * probe has answered.
 */
export async function mountNetworkBanner(opts: {
  url?: string;
  timeoutMs?: number;
  text?: string;
  Socket?: new (url: string) => SocketLike;
} = {}): Promise<"ok" | "blocked"> {
  const url = opts.url ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-probe`;
  const verdict = await probeWebSocket(url, opts.timeoutMs ?? 8000, opts.Socket ?? WebSocket);
  if (verdict === "blocked") {
    const banner = document.createElement("p");
    banner.className = "try-network-banner";
    banner.setAttribute("role", "alert");
    banner.textContent = opts.text ?? DEFAULT_TEXT;
    banner.style.cssText =
      "position:fixed;left:.8rem;right:.8rem;top:calc(.8rem + env(safe-area-inset-top));z-index:2147483000;margin:0 auto;max-width:36rem;padding:.8rem 1rem;border-radius:1rem;background:#7f1d1d;color:#fff;font:600 15px/1.35 system-ui,sans-serif;box-shadow:0 .4rem 1.4rem rgba(0,0,0,.6)";
    document.body.appendChild(banner);
  }
  return verdict;
}

/** A QR code of `text` (a join link) as an image data URL. */
export function qrDataUrl(text: string, cellSize = 8): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, 2);
}

/** Opens a seat's screen in a window on this computer ("No phone handy? Play on this computer"). */
export function openPlayerWindow(url: string, name = "try-player", size: { width: number; height: number } = { width: 460, height: 860 }): Window | null {
  return window.open(url, name, `popup,width=${size.width},height=${size.height}`);
}
