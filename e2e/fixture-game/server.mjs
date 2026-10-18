// A stand-in game for automated flows: its TV page is what the launcher frames. It answers the
// launcher's frame protocol (ogs:start -> ogs:resume-point) so the swap's resume label is testable.
//   node fixture-game/server.mjs [port=5190]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 5190);
const page = (
  title,
  body,
) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#1b0f3a;color:#fff6e0;font:700 72px system-ui;display:grid;place-items:center}</style></head><body>${body}</body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname.startsWith("/tv")) {
    const game = url.searchParams.get("game") ?? "fixture";
    const label = url.searchParams.get("label") ?? "Level 1";
    // ?room=: the TV page names its room (ogs:room), as a room-based game's TV page does.
    const room = url.searchParams.get("room");
    res.writeHead(200, { "content-type": "text/html" }).end(
      page(
        `${game} TV`,
        `<div data-testid="fixture-tv">${game} · ${label}</div>
<script>
  addEventListener("message", (e) => {
    if (e.data && e.data.type === "ogs:start") parent.postMessage({ type: "ogs:resume-point", label: ${JSON.stringify(label)} }, "*");
  });
  parent.postMessage({ type: "ogs:ready" }, "*");
  ${room ? `parent.postMessage({ type: "ogs:room", room: ${JSON.stringify(room)} }, "*");` : ""}
</script>`,
      ),
    );
    return;
  }
  res
    .writeHead(200, { "content-type": "text/html" })
    .end(page("fixture phone", `<div data-testid="fixture-phone">Controller</div>`));
}).listen(port, () => console.log(`fixture game on :${port}`));
