import type { LauncherToGame } from "@open-game-system/ogs-protocol";
import { scriptJson } from "./bridge-script";

export type HarnessPhone = {
  phone: number;
  name: string;
  avatar: string;
  /** The phone frame's URL (the start URL through this phone's bridge proxy). */
  url: string;
  /** The same on the LAN, for a real phone (null with no LAN address). */
  lanUrl: string | null;
  lanQr: string | null;
};

export type HarnessConfig = {
  appId: string;
  name: string;
  /** The TV page to frame; null for a room-based game until a phone sends cast SET_VIEW_URL. */
  tvUrl: string | null;
  start: LauncherToGame;
  phones: HarnessPhone[];
  /** The start URL on the LAN for a phone in a plain browser or the OGS app (no fake bridge). */
  startLanUrl: string | null;
  startLanQr: string | null;
  jwksUrl: string;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The harness page: the game's TV page framed as the OGS TV launcher frames it (ogs:start on load
 * and on ogs:ready, ogs:suspend / ogs:resume buttons), the phone frames, the QR codes for real
 * phones, and a log of every launcher and bridge message. `window.ogsDev.log` holds the log.
 */
export function harnessHtml(cfg: HarnessConfig): string {
  const phones = cfg.phones
    .map(
      (p) => `<figure class="phone">
  <figcaption><img src="${esc(p.avatar)}" alt=""> ${esc(p.name)}</figcaption>
  <iframe id="phone-${p.phone}" title="Phone ${p.phone}: ${esc(p.name)}" src="${esc(p.url)}" allow="autoplay; fullscreen; clipboard-write"></iframe>
</figure>`,
    )
    .join("\n");
  const qr = (src: string | null, url: string | null, label: string) =>
    src && url
      ? `<figure class="qr"><img src="${src}" alt="QR code of ${esc(url)}"><figcaption>${esc(label)}<br><a href="${esc(url)}">${esc(url)}</a></figcaption></figure>`
      : "";
  const qrs = [
    ...cfg.phones.map((p) => qr(p.lanQr, p.lanUrl, `${p.name}'s phone (fake OGS app)`)),
    qr(cfg.startLanQr, cfg.startLanUrl, "The start URL (plain browser or the OGS app)"),
  ].join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ogs dev: ${esc(cfg.name)}</title>
<style>
  :root { color-scheme: dark; --bg: #111214; --panel: #1b1d21; --line: #2c2f36; --text: #e8e8ea; --dim: #9a9ca3; --accent: #7cc4ff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
  header { display: flex; gap: 12px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  header h1 { font-size: 15px; margin: 0 auto 0 0; font-weight: 600; }
  header code { color: var(--dim); }
  button { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  main { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; padding: 16px; }
  .tv { background: #000; border: 1px solid var(--line); border-radius: 8px; aspect-ratio: 16 / 9; width: 100%; position: relative; overflow: hidden; }
  .tv iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .tv p { position: absolute; inset: 0; display: grid; place-items: center; color: var(--dim); margin: 0; padding: 24px; text-align: center; }
  .phones { display: flex; gap: 12px; flex-wrap: wrap; align-content: flex-start; }
  .phone { margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .phone figcaption { display: flex; gap: 6px; align-items: center; color: var(--dim); }
  .phone figcaption img { width: 20px; height: 20px; border-radius: 50%; }
  .phone iframe { width: 300px; height: 600px; border: 1px solid var(--line); border-radius: 18px; background: #fff; }
  section { padding: 0 16px 16px; }
  h2 { font-size: 13px; color: var(--dim); font-weight: 600; margin: 8px 0; text-transform: uppercase; letter-spacing: .04em; }
  .qrs { display: flex; gap: 16px; flex-wrap: wrap; }
  .qr { margin: 0; width: 200px; }
  .qr img { width: 200px; height: 200px; image-rendering: pixelated; background: #fff; border-radius: 6px; }
  .qr figcaption { color: var(--dim); font-size: 12px; word-break: break-all; }
  a { color: var(--accent); }
  #log { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px; max-height: 240px; overflow: auto; font: 12px/1.5 ui-monospace, monospace; margin: 0; white-space: pre-wrap; word-break: break-all; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } .phone iframe { width: min(300px, 100%); } }
</style>
</head>
<body>
<header>
  <h1>ogs dev: ${esc(cfg.name)} <code>${esc(cfg.appId)}</code></h1>
  <button id="suspend" type="button">ogs:suspend</button>
  <button id="resume" type="button">ogs:resume</button>
  <button id="restart" type="button">Reload TV</button>
</header>
<main>
  <div class="tv"><iframe id="tv" title="TV page" allow="autoplay; fullscreen"></iframe><p id="tv-empty" hidden>No TV page yet: this game has no tvUrl. It shows once a phone sends one (cast-kit useCastViewUrl), or run ogs dev --tv-url &lt;url&gt;.</p></div>
  <div class="phones">${phones}</div>
</main>
<section>
  <h2>Real phones (same Wi-Fi)</h2>
  <div class="qrs">${qrs || '<p style="color:var(--dim)">No LAN address found: connect to a network for real phones.</p>'}</div>
</section>
<section>
  <h2>Messages</h2>
  <pre id="log"></pre>
  <p style="color:var(--dim)">Game server: verify tokens with <code>OGS_JWKS_URL=${esc(cfg.jwksUrl)}</code></p>
</section>
<script id="ogs-dev-config" type="application/json">${scriptJson(cfg)}</script>
<script>
(function () {
  var cfg = JSON.parse(document.getElementById("ogs-dev-config").textContent);
  var tv = document.getElementById("tv");
  var tvUrl = null;
  var logEl = document.getElementById("log");
  window.ogsDev = { config: cfg, log: [] };
  function log(from, message) {
    window.ogsDev.log.push({ from: from, message: message });
    logEl.textContent += from + " " + JSON.stringify(message) + "\\n";
    logEl.scrollTop = logEl.scrollHeight;
  }
  function origin(url) { try { return new URL(url).origin; } catch (e) { return null; } }
  function post(message) {
    if (!tvUrl || !tv.contentWindow) return;
    tv.contentWindow.postMessage(message, origin(tvUrl));
    log("launcher → TV", message);
  }
  function showTv(url) {
    tvUrl = url;
    document.getElementById("tv-empty").hidden = !!url;
    if (url) tv.src = url;
  }
  tv.addEventListener("load", function () { if (tvUrl) post(cfg.start); });
  window.addEventListener("message", function (ev) {
    if (tvUrl && ev.source === tv.contentWindow) {
      if (ev.origin !== origin(tvUrl)) return;
      log("TV → launcher", ev.data);
      if (ev.data && ev.data.type === "ogs:ready") post(cfg.start);
      return;
    }
    var data = ev.data;
    if (!data || data.type !== "ogs-dev:bridge") return;
    var phone = cfg.phones.find(function (p) { return p.phone === data.phone; });
    log((phone ? phone.name : "phone " + data.phone) + " → app", data.message);
    var m = data.message;
    if (m && m.type === "EVENT" && m.storeKey === "cast" && m.event && m.event.type === "SET_VIEW_URL") showTv(m.event.url);
  });
  document.getElementById("suspend").onclick = function () { post({ type: "ogs:suspend" }); };
  document.getElementById("resume").onclick = function () { post({ type: "ogs:resume" }); };
  document.getElementById("restart").onclick = function () { if (tvUrl) { tv.src = "about:blank"; setTimeout(function () { tv.src = tvUrl; }, 0); } };
  showTv(cfg.tvUrl);
})();
</script>
</body>
</html>`;
}
