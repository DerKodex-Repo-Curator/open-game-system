import {
  getOgsSessionSource,
  onOgsPause,
  reportOgsRoom,
  reportOgsSitting,
} from "@open-game-system/profile-kit";
import qrcode from "qrcode-generator";
import { APP_ID } from "../client/config";
import { tvJoinUi } from "../client/ogs-plan";
import { connectRoom, createRoom } from "../client/socket";
import { FIELD, newWorld, type Seat, type Stick, step, syncShips, type World } from "../shared/sim";
import { createAudio } from "./audio";
import { createAudioPause } from "./audio-pause";

// OGS, at module load: start listening for the launcher's ogs:start (profile-kit says ogs:ready,
// so a start sent before this line ran is sent again) and go silent whenever the TV parks us.
const session = getOgsSessionSource();
const audio = createAudio();
const gate = createAudioPause(audio.ctx);
let parked = false;
onOgsPause((paused) => {
  parked = paused;
  gate.setPaused(paused);
});

const $ = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`#${id} missing`);
  return el;
};
const canvas = $("sky", HTMLCanvasElement);
const g = canvas.getContext("2d");
if (!g) throw new Error("no 2d context");

let world: World = newWorld(Date.now() % 100_000, performance.now());
let seats: Seat[] = [];
const sticks: Record<string, Stick> = {};
const trails: Record<string, { x: number; y: number }[]> = {};

async function main() {
  // A room per TV page: OGS opens /tv?room=CODE (the host phone made the room); a plain browser
  // opens /tv and the TV makes one.
  const params = new URLSearchParams(location.search);
  let code = params.get("room");
  if (!code) {
    code = await createRoom();
    params.set("room", code);
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }
  const room = connectRoom(code, { type: "screen" }, (msg) => {
    if (msg.type === "seats") {
      seats = msg.seats;
      world = syncShips(world, seats);
      renderOverlay(code);
    }
    if (msg.type === "stick") sticks[msg.id] = { x: msg.x, y: msg.y };
  });

  audio.start(); // the launcher lets a framed TV page play sound without a tap
  const unlock = () => void audio.ctx()?.resume();
  addEventListener("pointerdown", unlock); // a plain browser wants a click first
  addEventListener("keydown", unlock);

  session.subscribe(() => onSession(code));
  onSession(code);

  let last = performance.now();
  let lastSent = "";
  const frame = (now: number) => {
    const dt = Math.min(50, now - last);
    last = now;
    if (!parked) {
      const r = step(world, sticks, dt, now);
      const newRound = r.world.round !== world.round;
      world = r.world;
      r.caught.forEach((c, i) => {
        audio.chime(((world.ships[c.id]?.score ?? 0) % 8) + i);
      });
      const scores = Object.fromEntries(Object.values(world.ships).map((s) => [s.id, s.score]));
      const key = JSON.stringify([world.round, world.phase, scores]);
      if (key !== lastSent) {
        lastSent = key;
        renderScores();
        room.send({ type: "scores", round: world.round, phase: world.phase, scores });
      }
      if (newRound) reportSitting();
    }
    draw(now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** On the OGS TV: tell the launcher our room (the couch's phones follow into it) and our label. */
function onSession(code: string) {
  const s = session.getSnapshot();
  if (s) reportOgsRoom(code);
  reportSitting();
  renderOverlay(code);
}

function reportSitting() {
  const s = session.getSnapshot();
  if (!s) return;
  reportOgsSitting({
    instanceId: s.instanceId,
    appId: APP_ID,
    status: "active",
    title: `Round ${world.round}`,
  });
}

/** The join panel shows only in a plain browser; on the OGS TV, OGS draws its own TV code. */
function renderOverlay(code: string) {
  const ui = tvJoinUi(session.getSnapshot());
  const join = $("join", HTMLElement);
  join.hidden = ui !== "own";
  if (ui === "own") {
    const url = `${location.origin}/?room=${code}`;
    $("join-code", HTMLElement).textContent = code;
    $("join-url", HTMLElement).textContent = url.replace(/^https?:\/\//, "");
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("join-qr", HTMLImageElement).src = qr.createDataURL(6, 2);
  }
  const waiting = $("waiting", HTMLElement);
  const s = session.getSnapshot();
  waiting.hidden = seats.length > 0 || ui === "wait";
  const couch = s ? s.players.map((p) => p.name).join(", ") : "";
  waiting.textContent = couch ? `${couch}: pick up a phone to play` : "Waiting for players…";
}

// ─── Drawing ──────────────────────────────────────────────────────────────────────────────────
const bgStars = Array.from({ length: 160 }, (_, i) => ({
  x: (i * 7919) % FIELD.w,
  y: (i * 104_729) % FIELD.h,
  r: ((i * 31) % 3) * 0.5 + 0.5,
}));

function draw(now: number) {
  if (!g) return;
  const dpr = devicePixelRatio || 1;
  const w = innerWidth * dpr;
  const h = innerHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const scale = Math.min(w / FIELD.w, h / FIELD.h);
  const ox = (w - FIELD.w * scale) / 2;
  const oy = (h - FIELD.h * scale) / 2;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0b1033");
  sky.addColorStop(1, "#1d0f3a");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(ox, oy);
  g.scale(scale, scale);

  g.fillStyle = "rgba(255,255,255,0.5)";
  for (const s of bgStars) {
    g.globalAlpha = 0.35 + 0.35 * Math.sin(now / 900 + s.x);
    g.fillRect(s.x, s.y, s.r * 2, s.r * 2);
  }
  g.globalAlpha = 1;

  for (const star of world.stars) {
    const pulse = 1 + 0.15 * Math.sin(now / 200 + star.id);
    sparkle(g, star.x, star.y, 18 * pulse, "#fff6c8");
  }

  for (const ship of Object.values(world.ships)) {
    const trail = trails[ship.id] ?? [];
    trails[ship.id] = trail;
    trail.push({ x: ship.x, y: ship.y });
    if (trail.length > 24) trail.shift();
    trail.forEach((p, i) => {
      g.globalAlpha = (i / trail.length) * 0.5;
      g.fillStyle = ship.color;
      g.beginPath();
      g.arc(p.x, p.y, 6 + i * 0.7, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
    g.shadowColor = ship.color;
    g.shadowBlur = 30;
    g.fillStyle = ship.color;
    g.beginPath();
    g.arc(ship.x, ship.y, 24, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.font = "600 26px 'Avenir Next', system-ui, sans-serif";
    g.textAlign = "center";
    g.fillStyle = "#f4f1ff";
    g.fillText(ship.name, ship.x, ship.y + 58);
  }
  g.restore();

  const left = Math.max(0, Math.ceil((world.endsAt - now) / 1000));
  const winner = world.winner ? world.ships[world.winner]?.name : null;
  $("clock", HTMLElement).textContent =
    world.phase === "over"
      ? winner
        ? `${winner} wins round ${world.round}`
        : "Round over"
      : `${left}s`;
}

function renderScores() {
  $("scores", HTMLOListElement).replaceChildren(
    ...Object.values(world.ships).map((s) => {
      const li = document.createElement("li");
      const dot = document.createElement("i");
      dot.style.background = s.color;
      li.append(dot, `${s.name} ${s.score}`);
      return li;
    }),
  );
}

function sparkle(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  c.fillStyle = color;
  c.shadowColor = color;
  c.shadowBlur = 20;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.35;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  c.shadowBlur = 0;
}

void main();
