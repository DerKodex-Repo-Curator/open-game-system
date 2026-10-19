// The fixture game's TV page: what it hears from the OGS launcher, and what its server says of the token.
import { getOgsSessionSource, onOgsPause } from "@open-game-system/profile-kit";

const session = getOgsSessionSource();
const out = (id: string, text: string) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

session.subscribe(async () => {
  const s = session.getSnapshot();
  if (!s) return;
  out(
    "session",
    JSON.stringify({ players: s.players.map((p) => p.name), instanceId: s.instanceId }),
  );
  const res = await fetch("/verify", { method: "POST", body: s.token });
  out("verified", await res.text());
});
onOgsPause((paused) => out("paused", String(paused)));
