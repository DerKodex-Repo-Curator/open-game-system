import { getCastBridge, isOGSCastAvailable } from "@open-game-system/cast-kit-core";
import { getOgsProfileSource, type OgsProfile, ogsRoomFromUrl } from "@open-game-system/profile-kit";
import { phonePlan } from "../client/ogs-plan";
import { connectRoom, createRoom } from "../client/socket";
import type { ClientMessage } from "../shared/protocol";

const $ = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`#${id} missing`);
  return el;
};

/** One id per phone, so a reconnect keeps the same seat. */
function playerId(): string {
  try {
    const known = localStorage.getItem("playerId");
    if (known) return known;
    const id = crypto.randomUUID();
    localStorage.setItem("playerId", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** The profile once the OGS app has answered: null in a plain browser (profile-kit decides). */
function profileOnce(): Promise<OgsProfile | null> {
  const source = getOgsProfileSource();
  return new Promise((resolve) => {
    const check = () => {
      const p = source.getSnapshot();
      if (p === undefined) return false;
      resolve(p);
      return true;
    };
    if (check()) return;
    const off = source.subscribe(() => {
      if (check()) off();
    });
  });
}

/**
 * Inside the OGS app, the hosting phone declares the room's TV page; the app hands it to the TV
 * launcher, which frames it. cast-kit's `cast` store arrives from the app a moment after load, so
 * dispatch once it is there. No cast button: OGS does the casting.
 */
function declareTvPage(url: string) {
  const bridge = getCastBridge();
  if (!bridge) return;
  const tryDispatch = () => {
    const store = bridge.getStore("cast");
    if (!store) return false;
    store.dispatch({ type: "SET_VIEW_URL", url });
    return true;
  };
  if (tryDispatch()) return;
  const off = bridge.subscribe(() => {
    if (tryDispatch()) off();
  });
}

async function main() {
  const params = new URLSearchParams(location.search);
  const plan = phonePlan({
    profile: await profileOnce(),
    ogsRoom: ogsRoomFromUrl(location.href),
    urlRoom: params.get("room")?.toUpperCase() ?? null,
    inOgs: isOGSCastAvailable(),
  });
  if (plan.kind === "wait") return; // profileOnce never resolves to undefined
  if (plan.kind === "go") {
    let code: string;
    if ("make" in plan.room) {
      code = await createRoom();
      declareTvPage(`${location.origin}/tv?room=${code}`);
    } else code = plan.room.code;
    return play(code, { type: "join", playerId: playerId(), ogsToken: plan.join.token });
  }
  // A plain browser: the game's own form, unchanged by OGS.
  $("status", HTMLElement).hidden = true;
  const form = $("join-form", HTMLFormElement);
  form.hidden = false;
  const codeInput = $("code", HTMLInputElement);
  const nameInput = $("name", HTMLInputElement);
  if (plan.code) codeInput.value = plan.code;
  try {
    nameInput.value = localStorage.getItem("name") ?? "";
  } catch {}
  (plan.code ? nameInput : codeInput).focus();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    try {
      localStorage.setItem("name", name);
    } catch {}
    form.hidden = true;
    play(codeInput.value.trim().toUpperCase(), { type: "join", playerId: playerId(), name });
  });
}

function play(code: string, join: ClientMessage) {
  const status = $("status", HTMLElement);
  status.hidden = false;
  status.textContent = "Joining…";
  let myId = "";
  let myScore = 0;
  const room = connectRoom(code, join, (msg) => {
    if (msg.type === "welcome") {
      myId = msg.you.id;
      status.hidden = true;
      $("pad", HTMLElement).hidden = false;
      $("me-name", HTMLElement).textContent = msg.you.name;
      $("me-color", HTMLElement).style.background = msg.you.color;
    }
    if (msg.type === "scores") {
      const score = msg.scores[myId] ?? 0;
      if (score > myScore) navigator.vibrate?.(15);
      myScore = score;
      $("me-score", HTMLElement).textContent = String(score);
    }
    if (msg.type === "error") status.textContent = `Couldn't join: ${msg.message}`;
  });
  stick((x, y) => room.send({ type: "stick", x, y }));
}

/** A thumb stick on the pad (and the arrow keys, for testing on a laptop). Calls `send` at ≤ 20 Hz. */
function stick(send: (x: number, y: number) => void) {
  const area = $("stick-area", HTMLElement);
  const knob = $("stick-knob", HTMLElement);
  let origin: { x: number; y: number } | null = null;
  let current = { x: 0, y: 0 };
  let sent = "";
  const RADIUS = 70;
  const set = (x: number, y: number) => {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    current = { x: x * k, y: y * k };
    knob.style.transform = `translate(${current.x * RADIUS}px, ${current.y * RADIUS}px)`;
  };
  area.addEventListener("pointerdown", (e) => {
    area.setPointerCapture(e.pointerId);
    origin = { x: e.clientX, y: e.clientY };
  });
  area.addEventListener("pointermove", (e) => {
    if (origin) set((e.clientX - origin.x) / RADIUS, (e.clientY - origin.y) / RADIUS);
  });
  const release = () => {
    origin = null;
    set(0, 0);
  };
  area.addEventListener("pointerup", release);
  area.addEventListener("pointercancel", release);
  const keys = new Set<string>();
  const fromKeys = () =>
    set(
      (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0),
      (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0),
    );
  addEventListener("keydown", (e) => {
    keys.add(e.key);
    fromKeys();
  });
  addEventListener("keyup", (e) => {
    keys.delete(e.key);
    fromKeys();
  });
  setInterval(() => {
    const key = `${current.x.toFixed(2)},${current.y.toFixed(2)}`;
    if (key === sent) return;
    sent = key;
    send(Number(current.x.toFixed(2)), Number(current.y.toFixed(2)));
  }, 50);
}

void main();
